import { describe, expect, it } from "vitest";
import { GoParserAdapter } from "./go-parser-adapter";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

function createSnapshot(content: string, filePath = "main.go"): SourceSnapshot {
  return {
    snapshotId: `snap-${filePath}`,
    fileId: "file-1",
    filePath,
    content,
    language: "go",
    revision: "after",
    metadata: { codeHost: "test" },
  };
}

describe("GoParserAdapter", () => {
  const adapter = new GoParserAdapter();

  describe("supports", () => {
    it("supports .go files", () => {
      expect(adapter.supports(createSnapshot("", "main.go"))).toBe(true);
    });

    it("does not support .py files", () => {
      expect(
        adapter.supports({ ...createSnapshot(""), filePath: "test.py", language: "python" }),
      ).toBe(false);
    });
  });

  describe("parse", () => {
    it("extracts functions", async () => {
      const snapshot = createSnapshot(
        `package main\n\nfunc Hello() string {\n\treturn "hello"\n}\n\nfunc Goodbye() {\n}\n`,
      );
      const result = await adapter.parse(snapshot);
      const raw = result.raw as { symbols: Array<{ displayName: string; kind: string }> };
      const names = raw.symbols.map((s) => s.displayName);

      expect(names).toContain("Hello");
      expect(names).toContain("Goodbye");
    });

    it("extracts methods with receivers", async () => {
      const snapshot = createSnapshot(
        `package main\n\ntype Config struct {\n\tHost string\n}\n\nfunc (c *Config) Validate() error {\n\treturn nil\n}\n`,
      );
      const result = await adapter.parse(snapshot);
      const raw = result.raw as { symbols: Array<{ displayName: string; kind: string; container?: string }> };

      const method = raw.symbols.find((s) => s.displayName === "Validate");
      expect(method?.kind).toBe("method");
      expect(method?.container).toBe("Config");
    });

    it("extracts struct and interface types", async () => {
      const snapshot = createSnapshot(
        `package main\n\ntype UserService struct {\n\tdb *DB\n}\n\ntype Repository interface {\n\tFind(id string) error\n}\n`,
      );
      const result = await adapter.parse(snapshot);
      const raw = result.raw as { symbols: Array<{ displayName: string; kind: string }> };
      const names = raw.symbols.map((s) => s.displayName);

      expect(names).toContain("UserService");
      expect(names).toContain("Repository");
    });
  });

  describe("diff", () => {
    it("detects added functions", async () => {
      const before = await adapter.parse(
        createSnapshot("package main\n\nfunc Foo() {}\n"),
      );
      const after = await adapter.parse(
        createSnapshot("package main\n\nfunc Foo() {}\n\nfunc Bar() {}\n"),
      );
      const result = await adapter.diff({ before, after });

      const added = result.items.filter((i) => i.changeType === "added");
      expect(added).toHaveLength(1);
      expect(added[0].displayName).toBe("Bar");
    });

    it("detects removed functions", async () => {
      const before = await adapter.parse(
        createSnapshot("package main\n\nfunc Foo() {}\n\nfunc Bar() {}\n"),
      );
      const after = await adapter.parse(
        createSnapshot("package main\n\nfunc Foo() {}\n"),
      );
      const result = await adapter.diff({ before, after });

      const removed = result.items.filter((i) => i.changeType === "removed");
      expect(removed).toHaveLength(1);
      expect(removed[0].displayName).toBe("Bar");
    });

    it("detects modified functions", async () => {
      const before = await adapter.parse(
        createSnapshot("package main\n\nfunc Foo() {\n\treturn 1\n}\n"),
      );
      const after = await adapter.parse(
        createSnapshot("package main\n\nfunc Foo() {\n\treturn 2\n}\n"),
      );
      const result = await adapter.diff({ before, after });

      const modified = result.items.filter((i) => i.changeType === "modified");
      expect(modified).toHaveLength(1);
      expect(modified[0].displayName).toBe("Foo");
    });

    it("returns empty for identical content", async () => {
      const content = "package main\n\nfunc Foo() {}\n";
      const before = await adapter.parse(createSnapshot(content));
      const after = await adapter.parse(createSnapshot(content));
      const result = await adapter.diff({ before, after });

      expect(result.items).toHaveLength(0);
    });
  });
});
