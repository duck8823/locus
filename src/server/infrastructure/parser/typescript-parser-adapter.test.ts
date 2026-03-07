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
    expect(change.symbolKey).toBe("method::UserService::instance::updateProfile");
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

  it("normalizes property-call references without adding variable-owner method keys", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export function executeReview(): void {
  userService.updateProfile();
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export function executeReview(): void {
  userService.updateProfile();
  UserService.updateProfile();
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });
    const change = diff.items[0];

    expect(change).toBeDefined();
    expect(change?.references).toContain("function::<root>::updateProfile");
    expect(change?.references).toContain("method::UserService::static::updateProfile");
    expect(change?.references).not.toContain("method::userService::static::updateProfile");
  });

  it("detects signature-only changes even when the body stays the same", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export function convertValue(value: string): string {
  return String(value);
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export async function convertValue(value: number): Promise<string> {
  return String(value);
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.changeType).toBe("modified");
    expect(diff.items[0]?.bodySummary).toBe("Signature changed");
  });

  it("disambiguates static and instance methods with the same name", async () => {
    const adapter = new TypeScriptParserAdapter();
    const snapshot = createSnapshot({
      revision: "after",
      content: `
export class CacheStore {
  static flush(): void {
    console.info("flush static");
  }

  flush(): void {
    console.info("flush instance");
  }
}
`.trim(),
    });

    const parsed = await adapter.parse(snapshot);
    const raw = parsed.raw as { callables: Array<{ symbolKey: string }> };
    const keys = raw.callables.map((callable) => callable.symbolKey).sort();

    expect(keys).toEqual([
      "method::CacheStore::instance::flush",
      "method::CacheStore::static::flush",
    ]);
  });

  it("tracks anonymous default-exported functions", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export default function () {
  return 1;
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export default function () {
  return 2;
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.symbolKey).toBe("function::<root>::default");
    expect(diff.items[0]?.changeType).toBe("modified");
  });

  it("tracks methods in anonymous default-exported classes", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export default class {
  execute = () => 1;
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export default class {
  execute = () => 2;
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.symbolKey).toBe("method::default::instance::execute");
    expect(diff.items[0]?.changeType).toBe("modified");
  });

  it("tracks callable default export assignments", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export default (() => {
  return 1;
}) as () => number;
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export default (() => {
  return 2;
}) as () => number;
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.symbolKey).toBe("function::<root>::default");
    expect(diff.items[0]?.changeType).toBe("modified");
  });

  it("tracks wrapped callable class-property initializers", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
type Handler = (value: number) => number;

export class WrappedHandler {
  handler = ((value: number) => value + 1) as Handler;
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
type Handler = (value: number) => number;

export class WrappedHandler {
  handler = ((value: number) => value + 2) as Handler;
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.symbolKey).toBe("method::WrappedHandler::instance::handler");
    expect(diff.items[0]?.changeType).toBe("modified");
  });

  it("tracks declaration-only callable signature changes in .d.ts files", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      filePath: "types/public-api.d.ts",
      revision: "before",
      content: `
export declare function fetchUser(id: string): Promise<User>;
`.trim(),
    });
    const after = createSnapshot({
      filePath: "types/public-api.d.ts",
      revision: "after",
      content: `
export declare function fetchUser(id: number): Promise<User>;
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.symbolKey).toBe("function::<root>::fetchUser");
    expect(diff.items[0]?.bodySummary).toBe("Signature changed");
  });

  it("detects overload signature changes without dropping earlier overload entries", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      filePath: "types/overloads.d.ts",
      revision: "before",
      content: `
export declare function parseValue(input: string): string;
export declare function parseValue(input: number): string;
`.trim(),
    });
    const after = createSnapshot({
      filePath: "types/overloads.d.ts",
      revision: "after",
      content: `
export declare function parseValue(input: string, radix?: number): string;
export declare function parseValue(input: number): string;
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.symbolKey).toBe("function::<root>::parseValue");
    expect(diff.items[0]?.changeType).toBe("modified");
    expect(diff.items[0]?.bodySummary).toBe("Signature changed");
  });

  it("keeps existing overload implementations matched when a new overload is inserted", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      filePath: "types/format.d.ts",
      revision: "before",
      content: `
export function format(input: string): string;
export function format(input: number): string;
export function format(input: string | number): string {
  return String(input);
}
`.trim(),
    });
    const after = createSnapshot({
      filePath: "types/format.d.ts",
      revision: "after",
      content: `
export function format(input: boolean): string;
export function format(input: string): string;
export function format(input: number): string;
export function format(input: string | number): string {
  return String(input);
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.changeType).toBe("added");
    expect(diff.items[0]?.symbolKey).toBe("function::<root>::format");
    expect(diff.items[0]?.bodySummary).toBe("Callable added");
    expect(typeof diff.items[0]?.metadata?.instanceDiscriminator).toBe("string");
  });
});
