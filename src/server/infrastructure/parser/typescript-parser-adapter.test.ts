import { describe, expect, it } from "vitest";
import { createSeedSourceSnapshotPairs } from "@/server/application/services/seed-source-snapshot-fixture";
import { TypeScriptParserAdapter } from "@/server/infrastructure/parser/typescript-parser-adapter";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

function createSnapshot(overrides: Partial<SourceSnapshot>): SourceSnapshot {
  return {
    snapshotId: "snapshot",
    fileId: "file",
    filePath: "src/demo.ts",
    language: "typescript",
    revision: "before",
    content: "export function demo() { return 1; }",
    metadata: {
      codeHost: "github",
    },
    ...overrides,
  };
}

describe("TypeScriptParserAdapter", () => {
  it("detects callable modification while ignoring comment-only edits", async () => {
    const adapter = new TypeScriptParserAdapter();
    const pair = createSeedSourceSnapshotPairs("demo-review").find(
      (item) => item.fileId === "file-user-service",
    );

    expect(pair).toBeDefined();

    const before = await adapter.parse(pair!.before!);
    const after = await adapter.parse(pair!.after!);
    const diff = await adapter.diff({ before, after });

    expect(diff.items).toHaveLength(1);

    const change = diff.items[0];
    expect(change.displayName).toBe("updateProfile");
    expect(change.changeType).toBe("modified");
    expect(change.bodySummary).toBe("Body changed");
    expect(change.symbolKey).toBe("method::UserService::updateProfile");
    expect(change.references).toContain("function::<root>::formatPhone");
  });

  it("detects added and removed callables", async () => {
    const adapter = new TypeScriptParserAdapter();
    const pair = createSeedSourceSnapshotPairs("demo-review").find(
      (item) => item.fileId === "file-email-validator",
    );

    expect(pair).toBeDefined();

    const before = await adapter.parse(pair!.before!);
    const after = await adapter.parse(pair!.after!);
    const diff = await adapter.diff({ before, after });

    expect(
      diff.items.map((item) => ({
        key: item.symbolKey,
        type: item.changeType,
      })),
    ).toEqual([
      {
        key: "function::<root>::isLegacyDomain",
        type: "removed",
      },
      {
        key: "function::<root>::validatePhone",
        type: "added",
      },
    ]);
  });

  it("returns no diff for whitespace-only and comment-only edits", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export function keepValue(value: number): number {
  return value + 1;
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export function keepValue(value: number): number {
  // preserve current increment behavior

  return value + 1;
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toEqual([]);
  });

  it("supports only TypeScript snapshots", () => {
    const adapter = new TypeScriptParserAdapter();

    expect(adapter.supports(createSnapshot({ language: "typescript" }))).toBe(true);
    expect(adapter.supports(createSnapshot({ language: "tsx", filePath: "src/demo.tsx" }))).toBe(true);
    expect(
      adapter.supports(
        createSnapshot({
          language: "markdown",
          filePath: "docs/demo.md",
        }),
      ),
    ).toBe(false);
  });

  it("does not create standalone diffs for nested local callables", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export function outer(): number {
  const local = () => 1;
  return local();
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export function outer(): number {
  const local = () => 2;
  return local();
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.symbolKey).toBe("function::<root>::outer");
  });

  it("ignores overload signatures without implementation bodies", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export function serialize(value: string): string;
export function serialize(value: number): string;
export function serialize(value: string | number): string {
  return String(value);
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export function serialize(value: string): string;
export function serialize(value: number): string;
export function serialize(value: string | number): string {
  return String(value);
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toEqual([]);
  });
});
