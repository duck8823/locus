import { describe, expect, it } from "vitest";
import { PythonParserAdapter } from "./python-parser-adapter";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

function createSnapshot(
  content: string,
  filePath = "module.py",
): SourceSnapshot {
  return {
    snapshotId: `snap-${filePath}`,
    fileId: "file-1",
    filePath,
    content,
    language: "python",
    revision: "after",
    metadata: { codeHost: "test" },
  };
}

describe("PythonParserAdapter", () => {
  const adapter = new PythonParserAdapter();

  describe("supports", () => {
    it("supports .py files", () => {
      expect(adapter.supports(createSnapshot("", "test.py"))).toBe(true);
    });

    it("supports python language", () => {
      expect(
        adapter.supports({
          ...createSnapshot(""),
          filePath: "test",
          language: "python",
        }),
      ).toBe(true);
    });

    it("does not support .ts files", () => {
      expect(
        adapter.supports({
          ...createSnapshot(""),
          filePath: "test.ts",
          language: "typescript",
        }),
      ).toBe(false);
    });
  });

  describe("parse", () => {
    it("extracts top-level functions", async () => {
      const snapshot = createSnapshot(
        `def greet(name):\n    return f"Hello, {name}"\n\ndef farewell():\n    pass\n`,
      );
      const result = await adapter.parse(snapshot);
      const raw = result.raw as { symbols: Array<{ displayName: string; kind: string }> };
      const names = raw.symbols.map((s) => s.displayName);

      expect(names).toContain("greet");
      expect(names).toContain("farewell");
      expect(raw.symbols.every((s) => s.kind === "function")).toBe(true);
    });

    it("extracts classes and methods", async () => {
      const snapshot = createSnapshot(
        `class UserService:\n    def __init__(self):\n        self.db = None\n\n    def get_user(self, user_id):\n        return self.db.get(user_id)\n`,
      );
      const result = await adapter.parse(snapshot);
      const raw = result.raw as { symbols: Array<{ displayName: string; kind: string; container?: string }> };

      const classSymbol = raw.symbols.find((s) => s.displayName === "UserService");
      expect(classSymbol?.kind).toBe("class");

      const methodSymbol = raw.symbols.find((s) => s.displayName === "get_user");
      expect(methodSymbol?.kind).toBe("method");
      expect(methodSymbol?.container).toBe("UserService");
    });

    it("handles decorated functions", async () => {
      const snapshot = createSnapshot(
        `@app.route("/api")\ndef handle_request():\n    return "ok"\n`,
      );
      const result = await adapter.parse(snapshot);
      const raw = result.raw as { symbols: Array<{ displayName: string; decorators: string[] }> };

      const fn = raw.symbols.find((s) => s.displayName === "handle_request");
      expect(fn).toBeDefined();
      expect(fn!.decorators.length).toBeGreaterThan(0);
    });
  });

  describe("diff", () => {
    it("detects added functions", async () => {
      const before = await adapter.parse(
        createSnapshot("def foo():\n    pass\n"),
      );
      const after = await adapter.parse(
        createSnapshot("def foo():\n    pass\n\ndef bar():\n    pass\n"),
      );
      const result = await adapter.diff({ before, after });

      const added = result.items.filter((i) => i.changeType === "added");
      expect(added).toHaveLength(1);
      expect(added[0].displayName).toBe("bar");
    });

    it("detects removed functions", async () => {
      const before = await adapter.parse(
        createSnapshot("def foo():\n    pass\n\ndef bar():\n    pass\n"),
      );
      const after = await adapter.parse(
        createSnapshot("def foo():\n    pass\n"),
      );
      const result = await adapter.diff({ before, after });

      const removed = result.items.filter((i) => i.changeType === "removed");
      expect(removed).toHaveLength(1);
      expect(removed[0].displayName).toBe("bar");
    });

    it("detects modified functions", async () => {
      const before = await adapter.parse(
        createSnapshot("def foo():\n    return 1\n"),
      );
      const after = await adapter.parse(
        createSnapshot("def foo():\n    return 2\n"),
      );
      const result = await adapter.diff({ before, after });

      const modified = result.items.filter((i) => i.changeType === "modified");
      expect(modified).toHaveLength(1);
      expect(modified[0].displayName).toBe("foo");
    });

    it("returns empty for identical content", async () => {
      const content = "def foo():\n    return 1\n";
      const before = await adapter.parse(createSnapshot(content));
      const after = await adapter.parse(createSnapshot(content));
      const result = await adapter.diff({ before, after });

      expect(result.items).toHaveLength(0);
    });

    it("handles null before (all added)", async () => {
      const after = await adapter.parse(
        createSnapshot("def new_func():\n    pass\n"),
      );
      const result = await adapter.diff({ before: null, after });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].changeType).toBe("added");
    });

    it("handles null after (all removed)", async () => {
      const before = await adapter.parse(
        createSnapshot("def old_func():\n    pass\n"),
      );
      const result = await adapter.diff({ before, after: null });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].changeType).toBe("removed");
    });
  });

  describe("capabilities", () => {
    it("reports callableDiff as true", () => {
      expect(adapter.capabilities().callableDiff).toBe(true);
    });
  });
});
