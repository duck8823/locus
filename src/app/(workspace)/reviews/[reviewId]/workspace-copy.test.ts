import { describe, expect, it } from "vitest";
import {
  formatArchitectureColumnLabel,
  formatReviewGroupStatus,
  formatSemanticChangeType,
  formatSemanticSymbolKind,
  formatUnsupportedReason,
  resolveWorkspaceLocale,
} from "./workspace-copy";

describe("workspace-copy", () => {
  it("prefers explicit locale cookie over accept-language", () => {
    expect(
      resolveWorkspaceLocale({
        preferredLocale: "ja-JP",
        acceptLanguage: "en-US,en;q=0.9",
      }),
    ).toBe("ja");
  });

  it("falls back to accept-language when preferred locale is missing", () => {
    expect(
      resolveWorkspaceLocale({
        preferredLocale: null,
        acceptLanguage: "fr-FR,ja;q=0.9,en;q=0.8",
      }),
    ).toBe("ja");
  });

  it("falls back to english when no supported locale is provided", () => {
    expect(
      resolveWorkspaceLocale({
        preferredLocale: null,
        acceptLanguage: "fr-FR,de-DE",
      }),
    ).toBe("en");
  });

  it("formats review-group and semantic labels in japanese", () => {
    expect(formatReviewGroupStatus("in_progress", "ja")).toBe("確認中");
    expect(formatSemanticChangeType("renamed", "ja")).toBe("改名");
    expect(formatSemanticSymbolKind("method", "ja")).toBe("メソッド");
    expect(formatUnsupportedReason("parser_failed", "ja")).toBe("パーサー失敗");
    expect(formatArchitectureColumnLabel("upstream", "ja")).toBe("上流");
  });
});
