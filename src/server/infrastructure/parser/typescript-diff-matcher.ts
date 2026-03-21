import type { ParsedSnapshot, ParserDiffItem } from "@/server/application/ports/parser-adapter";
import type { ParsedCallable, ParsedTypeScriptSnapshotRaw } from "./typescript-callable-parser";

export interface CallableMatch {
  before: ParsedCallable | null;
  after: ParsedCallable | null;
}

export function assertParsedSnapshot(snapshot: ParsedSnapshot | null): ParsedTypeScriptSnapshotRaw {
  if (!snapshot) {
    return { callables: [] };
  }

  return snapshot.raw as ParsedTypeScriptSnapshotRaw;
}

export function createModifiedSummary(before: ParsedCallable, after: ParsedCallable): string {
  const signatureChanged = before.normalizedSignature !== after.normalizedSignature;
  const bodyChanged = before.normalizedBody !== after.normalizedBody;

  if (signatureChanged && bodyChanged) {
    return "Signature and body changed";
  }

  if (signatureChanged) {
    return "Signature changed";
  }

  if (bodyChanged) {
    return "Body changed";
  }

  return "Callable updated";
}

export function groupCallablesBySymbol(callables: ParsedCallable[]): Map<string, ParsedCallable[]> {
  const grouped = new Map<string, ParsedCallable[]>();

  for (const callable of callables) {
    const group = grouped.get(callable.symbolKey) ?? [];
    group.push(callable);
    grouped.set(callable.symbolKey, group);
  }

  return grouped;
}

function consumeMatchingPair(
  beforeCallables: ParsedCallable[],
  afterCallables: ParsedCallable[],
  predicate: (before: ParsedCallable, after: ParsedCallable) => boolean,
): CallableMatch[] {
  const matches: CallableMatch[] = [];

  for (let beforeIndex = beforeCallables.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    const beforeCallable = beforeCallables[beforeIndex];
    const afterIndex = afterCallables.findIndex((afterCallable) =>
      predicate(beforeCallable, afterCallable),
    );

    if (afterIndex < 0) {
      continue;
    }

    const [matchedBefore] = beforeCallables.splice(beforeIndex, 1);
    const [matchedAfter] = afterCallables.splice(afterIndex, 1);
    matches.push({
      before: matchedBefore ?? null,
      after: matchedAfter ?? null,
    });
  }

  return matches;
}

export function matchCallableGroup(
  beforeGroup: ParsedCallable[],
  afterGroup: ParsedCallable[],
): CallableMatch[] {
  const remainingBefore = [...beforeGroup];
  const remainingAfter = [...afterGroup];
  const matches: CallableMatch[] = [];

  matches.push(
    ...consumeMatchingPair(
      remainingBefore,
      remainingAfter,
      (beforeCallable, afterCallable) =>
        beforeCallable.normalizedSignature === afterCallable.normalizedSignature &&
        beforeCallable.normalizedBody === afterCallable.normalizedBody,
    ),
  );

  matches.push(
    ...consumeMatchingPair(
      remainingBefore,
      remainingAfter,
      (beforeCallable, afterCallable) =>
        beforeCallable.normalizedSignature === afterCallable.normalizedSignature,
    ),
  );

  matches.push(
    ...consumeMatchingPair(
      remainingBefore,
      remainingAfter,
      (beforeCallable, afterCallable) => beforeCallable.normalizedBody === afterCallable.normalizedBody,
    ),
  );

  remainingBefore.sort((a, b) => a.region.startLine - b.region.startLine);
  remainingAfter.sort((a, b) => a.region.startLine - b.region.startLine);

  while (remainingBefore.length > 0 && remainingAfter.length > 0) {
    matches.push({
      before: remainingBefore.shift() ?? null,
      after: remainingAfter.shift() ?? null,
    });
  }

  for (const callable of remainingBefore) {
    matches.push({
      before: callable,
      after: null,
    });
  }

  for (const callable of remainingAfter) {
    matches.push({
      before: null,
      after: callable,
    });
  }

  return matches;
}

export function createInstanceDiscriminator(match: CallableMatch): string {
  const beforeRegion = match.before
    ? `${match.before.region.startLine}-${match.before.region.endLine}`
    : "na";
  const afterRegion = match.after
    ? `${match.after.region.startLine}-${match.after.region.endLine}`
    : "na";
  const beforeSignature = match.before?.normalizedSignature ?? "na";
  const afterSignature = match.after?.normalizedSignature ?? "na";

  return `${beforeRegion}|${afterRegion}|${beforeSignature}|${afterSignature}`;
}

export function computeDiffItems(
  before: ParsedTypeScriptSnapshotRaw,
  after: ParsedTypeScriptSnapshotRaw,
): ParserDiffItem[] {
  const beforeBySymbol = groupCallablesBySymbol(before.callables);
  const afterBySymbol = groupCallablesBySymbol(after.callables);
  const symbolKeys = Array.from(new Set([...beforeBySymbol.keys(), ...afterBySymbol.keys()])).sort((a, b) =>
    a.localeCompare(b),
  );
  const items: ParserDiffItem[] = [];

  for (const symbolKey of symbolKeys) {
    const matches = matchCallableGroup(
      beforeBySymbol.get(symbolKey) ?? [],
      afterBySymbol.get(symbolKey) ?? [],
    );

    for (const match of matches) {
      const beforeCallable = match.before;
      const afterCallable = match.after;
      const instanceDiscriminator = createInstanceDiscriminator(match);

      if (!beforeCallable && afterCallable) {
        items.push({
          symbolKey: afterCallable.symbolKey,
          displayName: afterCallable.displayName,
          kind: afterCallable.kind,
          container: afterCallable.container,
          changeType: "added",
          signatureSummary: afterCallable.signatureSummary,
          bodySummary: "Callable added",
          references: afterCallable.references,
          afterRegion: afterCallable.region,
          metadata: {
            instanceDiscriminator,
          },
        });
        continue;
      }

      if (beforeCallable && !afterCallable) {
        items.push({
          symbolKey: beforeCallable.symbolKey,
          displayName: beforeCallable.displayName,
          kind: beforeCallable.kind,
          container: beforeCallable.container,
          changeType: "removed",
          signatureSummary: beforeCallable.signatureSummary,
          bodySummary: "Callable removed",
          references: beforeCallable.references,
          beforeRegion: beforeCallable.region,
          metadata: {
            instanceDiscriminator,
          },
        });
        continue;
      }

      if (!beforeCallable || !afterCallable) {
        continue;
      }

      if (beforeCallable.normalizedText === afterCallable.normalizedText) {
        continue;
      }

      items.push({
        symbolKey: afterCallable.symbolKey,
        displayName: afterCallable.displayName,
        kind: afterCallable.kind,
        container: afterCallable.container,
        changeType: "modified",
        signatureSummary: afterCallable.signatureSummary,
        bodySummary: createModifiedSummary(beforeCallable, afterCallable),
        references: afterCallable.references,
        beforeRegion: beforeCallable.region,
        afterRegion: afterCallable.region,
        metadata: {
          instanceDiscriminator,
        },
      });
    }
  }

  return items;
}
