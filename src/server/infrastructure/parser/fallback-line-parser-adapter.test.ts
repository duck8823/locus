import { describe, expect, it } from "vitest";
import { FallbackLineParserAdapter } from "./fallback-line-parser-adapter";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

function createSnapshot(content: string, language: string | null = null, filePath = "test.py"): SourceSnapshot {
  return {
    snapshotId: "snap-1",
    fileId: "file-1",
    filePath,
    content,
    language,
    revision: "after",
    metadata: { codeHost: "test" },
  };
}

describe("FallbackLineParserAdapter", () => {
  const adapter = new FallbackLineParserAdapter();

  it("supports any file", () => {
    expect(adapter.supports(createSnapshot("", "ruby", "test.rb"))).toBe(true);
    expect(adapter.supports(createSnapshot("", "java", "Test.java"))).toBe(true);
  });

  describe("parse", () => {
    it("detects Python functions and classes", async () => {
      const snapshot = createSnapshot(
        `class UserService:\n    def get_user(self, user_id):\n        return db.get(user_id)\n\ndef standalone():\n    pass\n`,
        "python",
      );
      const result = await adapter.parse(snapshot);
      const raw = result.raw as { symbols: Array<{ displayName: string; kind: string }> };
      const names = raw.symbols.map((s) => s.displayName);

      expect(names).toContain("UserService");
      expect(names).toContain("get_user");
      expect(names).toContain("standalone");
    });

    it("detects Go functions and types", async () => {
      const snapshot = createSnapshot(
        `package main\n\ntype Config struct {\n\tHost string\n}\n\nfunc NewConfig() *Config {\n\treturn &Config{}\n}\n\nfunc (c *Config) Validate() error {\n\treturn nil\n}\n`,
        "go",
        "config.go",
      );
      const result = await adapter.parse(snapshot);
      const raw = result.raw as { symbols: Array<{ displayName: string; kind: string }> };
      const names = raw.symbols.map((s) => s.displayName);

      expect(names).toContain("Config");
      expect(names).toContain("NewConfig");
      expect(names).toContain("Validate");
    });

    it("detects Rust functions and structs", async () => {
      const snapshot = createSnapshot(
        `pub struct Config {\n    host: String,\n}\n\npub fn new_config() -> Config {\n    Config { host: String::new() }\n}\n`,
        "rust",
        "config.rs",
      );
      const result = await adapter.parse(snapshot);
      const raw = result.raw as { symbols: Array<{ displayName: string; kind: string }> };
      const names = raw.symbols.map((s) => s.displayName);

      expect(names).toContain("Config");
      expect(names).toContain("new_config");
    });

    it("detects Java class and methods", async () => {
      const snapshot = createSnapshot(
        `public class UserService {\n    public User getUser(String id) {\n        return db.get(id);\n    }\n}\n`,
        "java",
        "UserService.java",
      );
      const result = await adapter.parse(snapshot);
      const raw = result.raw as { symbols: Array<{ displayName: string; kind: string }> };
      const names = raw.symbols.map((s) => s.displayName);

      expect(names).toContain("UserService");
      expect(names).toContain("getUser");
    });
  });

  describe("diff", () => {
    it("detects added symbols", async () => {
      const before = await adapter.parse(createSnapshot("def foo():\n    pass\n", "python"));
      const after = await adapter.parse(
        createSnapshot("def foo():\n    pass\n\ndef bar():\n    pass\n", "python"),
      );
      const result = await adapter.diff({ before, after });

      const added = result.items.filter((i) => i.changeType === "added");
      expect(added).toHaveLength(1);
      expect(added[0].displayName).toBe("bar");
    });

    it("detects removed symbols", async () => {
      const before = await adapter.parse(
        createSnapshot("def foo():\n    pass\n\ndef bar():\n    pass\n", "python"),
      );
      const after = await adapter.parse(createSnapshot("def foo():\n    pass\n", "python"));
      const result = await adapter.diff({ before, after });

      const removed = result.items.filter((i) => i.changeType === "removed");
      expect(removed).toHaveLength(1);
      expect(removed[0].displayName).toBe("bar");
    });

    it("detects modified symbols", async () => {
      const before = await adapter.parse(
        createSnapshot("def foo():\n    return 1\n", "python"),
      );
      const after = await adapter.parse(
        createSnapshot("def foo():\n    return 2\n", "python"),
      );
      const result = await adapter.diff({ before, after });

      const modified = result.items.filter((i) => i.changeType === "modified");
      expect(modified).toHaveLength(1);
      expect(modified[0].displayName).toBe("foo");
    });

    it("returns empty items for identical content", async () => {
      const content = "def foo():\n    return 1\n";
      const before = await adapter.parse(createSnapshot(content, "python"));
      const after = await adapter.parse(createSnapshot(content, "python"));
      const result = await adapter.diff({ before, after });

      expect(result.items).toHaveLength(0);
    });
  });
});
