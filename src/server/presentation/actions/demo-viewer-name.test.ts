import { describe, expect, it } from "vitest";
import { resolveDemoViewerName } from "./demo-viewer-name";

describe("resolveDemoViewerName", () => {
  it("returns japanese label for ja locale", () => {
    expect(resolveDemoViewerName("ja")).toBe("デモレビュアー");
    expect(resolveDemoViewerName("ja-JP")).toBe("デモレビュアー");
  });

  it("returns english label for non-ja locales", () => {
    expect(resolveDemoViewerName("en")).toBe("Demo reviewer");
    expect(resolveDemoViewerName("fr")).toBe("Demo reviewer");
  });

  it("falls back to english when locale is empty", () => {
    expect(resolveDemoViewerName(undefined)).toBe("Demo reviewer");
    expect(resolveDemoViewerName(" ")).toBe("Demo reviewer");
  });
});
