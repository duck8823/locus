import { describe, expect, it } from "vitest";
import { ParserAdapterRegistry } from "./parser-adapter-registry";
import type { ParserAdapter, ParsedSnapshot, ParserDiffResult, ParserCapabilities } from "@/server/application/ports/parser-adapter";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

function createStubAdapter(overrides: Partial<ParserAdapter> & { language: string; adapterName: string }): ParserAdapter {
  return {
    supports: () => false,
    parse: async () => ({ snapshotId: "", adapterName: overrides.adapterName, language: overrides.language, raw: {} }),
    diff: async () => ({ adapterName: overrides.adapterName, language: overrides.language, items: [] }),
    capabilities: () => ({ callableDiff: false, importGraph: false, renameDetection: false, moveDetection: false, typeAwareSummary: false }),
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    snapshotId: "snap-1",
    fileId: "file-1",
    filePath: "test.ts",
    content: "",
    language: "typescript",
    revision: "after",
    metadata: { codeHost: "test" },
    ...overrides,
  };
}

describe("ParserAdapterRegistry", () => {
  it("returns null when no adapter supports the file", () => {
    const registry = new ParserAdapterRegistry();
    expect(registry.resolve(createSnapshot())).toBeNull();
  });

  it("resolves the first matching adapter", () => {
    const registry = new ParserAdapterRegistry();
    const tsAdapter = createStubAdapter({
      language: "typescript",
      adapterName: "ts",
      supports: (file) => file.language === "typescript",
    });
    const pyAdapter = createStubAdapter({
      language: "python",
      adapterName: "py",
      supports: (file) => file.language === "python",
    });
    registry.register(tsAdapter);
    registry.register(pyAdapter);

    expect(registry.resolve(createSnapshot({ language: "python" }))).toBe(pyAdapter);
    expect(registry.resolve(createSnapshot({ language: "typescript" }))).toBe(tsAdapter);
  });

  it("lists registered adapters in order", () => {
    const registry = new ParserAdapterRegistry();
    const a = createStubAdapter({ language: "a", adapterName: "a" });
    const b = createStubAdapter({ language: "b", adapterName: "b" });
    registry.register(a);
    registry.register(b);

    expect(registry.listAdapters()).toEqual([a, b]);
  });

  it("toArray returns a copy", () => {
    const registry = new ParserAdapterRegistry();
    const a = createStubAdapter({ language: "a", adapterName: "a" });
    registry.register(a);

    const array = registry.toArray();
    array.push(createStubAdapter({ language: "b", adapterName: "b" }));
    expect(registry.listAdapters()).toHaveLength(1);
  });
});
