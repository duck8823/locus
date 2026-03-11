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

  it("detects token-boundary changes that alter operator semantics", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export function compute(a: number, b: number): number {
  return a + ++b;
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export function compute(a: number, b: number): number {
  return a+++b;
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.symbolKey).toBe("function::<root>::compute");
    expect(diff.items[0]?.changeType).toBe("modified");
    expect(diff.items[0]?.bodySummary).toBe("Body changed");
  });

  it("supports TypeScript and JavaScript snapshots", () => {
    const adapter = new TypeScriptParserAdapter();

    expect(adapter.supports(createSnapshot({ language: "typescript" }))).toBe(true);
    expect(adapter.supports(createSnapshot({ language: "tsx", filePath: "src/demo.tsx" }))).toBe(true);
    expect(adapter.supports(createSnapshot({ language: "javascript", filePath: "src/demo.js" }))).toBe(true);
    expect(adapter.supports(createSnapshot({ language: "jsx", filePath: "src/demo.jsx" }))).toBe(true);
    expect(
      adapter.supports(
        createSnapshot({
          language: "markdown",
          filePath: "docs/demo.md",
        }),
      ),
    ).toBe(false);
  });

  it("detects callable changes in JavaScript and JSX files", async () => {
    const adapter = new TypeScriptParserAdapter();
    const beforeJavaScript = createSnapshot({
      filePath: "src/run-workflow.js",
      language: "javascript",
      revision: "before",
      content: `
export function runWorkflow(value) {
  return normalize(value);
}
`.trim(),
    });
    const afterJavaScript = createSnapshot({
      filePath: "src/run-workflow.js",
      language: "javascript",
      revision: "after",
      content: `
export function runWorkflow(value) {
  return normalize(value.trim());
}
`.trim(),
    });
    const beforeJsx = createSnapshot({
      filePath: "src/header.jsx",
      language: "jsx",
      revision: "before",
      content: `
export function Header() {
  return <h1>Locus</h1>;
}
`.trim(),
    });
    const afterJsx = createSnapshot({
      filePath: "src/header.jsx",
      language: "jsx",
      revision: "after",
      content: `
export function Header() {
  return <h1 data-locale="ja">Locus</h1>;
}
`.trim(),
    });

    const jsDiff = await adapter.diff({
      before: await adapter.parse(beforeJavaScript),
      after: await adapter.parse(afterJavaScript),
    });
    const jsxDiff = await adapter.diff({
      before: await adapter.parse(beforeJsx),
      after: await adapter.parse(afterJsx),
    });

    expect(jsDiff.items).toHaveLength(1);
    expect(jsDiff.items[0]?.symbolKey).toBe("function::<root>::runWorkflow");
    expect(jsDiff.items[0]?.changeType).toBe("modified");
    expect(jsxDiff.items).toHaveLength(1);
    expect(jsxDiff.items[0]?.symbolKey).toBe("function::<root>::Header");
    expect(jsxDiff.items[0]?.changeType).toBe("modified");
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

  it("tracks constructor body changes as semantic callable updates", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export class SessionStore {
  constructor(seed: number) {
    this.seed = seed + 1;
  }

  private seed: number;
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export class SessionStore {
  constructor(seed: number) {
    this.seed = seed + 2;
  }

  private seed: number;
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.symbolKey).toBe("method::SessionStore::instance::constructor");
    expect(diff.items[0]?.changeType).toBe("modified");
    expect(diff.items[0]?.bodySummary).toBe("Body changed");
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

  it("tracks declaration-only class method signature changes", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      filePath: "types/repository.d.ts",
      revision: "before",
      content: `
export declare abstract class Repository {
  abstract findById(id: string): Promise<User>;
}
`.trim(),
    });
    const after = createSnapshot({
      filePath: "types/repository.d.ts",
      revision: "after",
      content: `
export declare abstract class Repository {
  abstract findById(id: number): Promise<User>;
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.symbolKey).toBe("method::Repository::instance::findById");
    expect(diff.items[0]?.changeType).toBe("modified");
    expect(diff.items[0]?.bodySummary).toBe("Signature changed");
  });

  it("tracks declaration-only constructor signature changes", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      filePath: "types/session-store.d.ts",
      revision: "before",
      content: `
export declare class SessionStore {
  constructor(seed: number);
}
`.trim(),
    });
    const after = createSnapshot({
      filePath: "types/session-store.d.ts",
      revision: "after",
      content: `
export declare class SessionStore {
  constructor(seed: string);
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.symbolKey).toBe("method::SessionStore::instance::constructor");
    expect(diff.items[0]?.changeType).toBe("modified");
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

  it("collects optional-chaining call references from property and element access", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export function runWorkflow(): void {
  UserService.updateProfile();
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export function runWorkflow(): void {
  UserService?.updateProfile?.();
  UserService["refresh"]?.();
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.references).toEqual([
      "function::<root>::refresh",
      "function::<root>::updateProfile",
      "method::UserService::static::refresh",
      "method::UserService::static::updateProfile",
    ]);
  });

  it("keeps symbol keys stable across repeated parses", async () => {
    const adapter = new TypeScriptParserAdapter();
    const snapshot = createSnapshot({
      revision: "after",
      content: `
export class ServiceStore {
  update = (value: number) => value + 1;

  static flush(): void {
    console.info("flush");
  }

  flush(): void {
    console.info("instance flush");
  }
}

export function run(): void {}
`.trim(),
    });

    const firstParse = await adapter.parse(snapshot);
    const secondParse = await adapter.parse(snapshot);
    const firstKeys = (firstParse.raw as { callables: Array<{ symbolKey: string }> }).callables
      .map((callable) => callable.symbolKey)
      .sort();
    const secondKeys = (secondParse.raw as { callables: Array<{ symbolKey: string }> }).callables
      .map((callable) => callable.symbolKey)
      .sort();

    expect(firstKeys).toEqual(secondKeys);
  });

  it("tracks call references through imported aliases", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
import { validateEmail as validateInput } from "./validator";

export function runValidation(value: string): boolean {
  return validateInput(value);
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
import { validateEmail as validateInput } from "./validator";

export function runValidation(value: string): boolean {
  const normalized = value.trim();
  return validateInput(normalized);
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]?.references).toContain("function::<root>::validateInput");
    expect(diff.items[0]?.references).toContain("function::<root>::validateEmail");
  });

  it("normalizes imported owner aliases for static method references", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
import { UserService as Service } from "./user-service";

export function runTasks(): void {
  Service.updateProfile();
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
import { UserService as Service } from "./user-service";

export function runTasks(): void {
  Service.updateProfile();
  Service.cleanup();
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });
    const references = diff.items[0]?.references ?? [];

    expect(diff.items).toHaveLength(1);
    expect(references).toContain("method::Service::static::cleanup");
    expect(references).toContain("method::UserService::static::cleanup");
    expect(references).toContain("function::<root>::cleanup");
  });

  it("tracks namespace-qualified static call references", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export function runTasks(): void {
  API.Tasks.execute();
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export function runTasks(): void {
  API.Tasks.execute();
  API.Tasks["cleanup"]?.();
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });
    const references = diff.items[0]?.references ?? [];

    expect(references).toContain("function::<root>::cleanup");
    expect(references).toContain("method::API::Tasks::static::cleanup");
    expect(references).toContain("method::API::Tasks::static::execute");
  });

  it("ignores re-export-only changes without callable body changes", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export { runTasks } from "./tasks";
export type { TaskInput } from "./types";
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export { runTasks, runCleanup } from "./tasks";
export type { TaskInput, TaskOutput } from "./types";
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toEqual([]);
  });
});
