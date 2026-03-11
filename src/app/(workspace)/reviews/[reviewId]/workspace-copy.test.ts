import { describe, expect, it } from "vitest";
import {
  workspaceCopyByLocale,
  formatArchitectureColumnLabel,
  formatBusinessContextSourceType,
  formatBusinessContextStatus,
  formatReviewGroupStatus,
  formatSemanticChangeType,
  formatSemanticSymbolKind,
  formatUnsupportedReason,
} from "./workspace-copy";

describe("workspace-copy", () => {
  it("formats review-group and semantic labels in japanese", () => {
    expect(formatReviewGroupStatus("in_progress", "ja")).toBe("確認中");
    expect(formatSemanticChangeType("renamed", "ja")).toBe("改名");
    expect(formatSemanticSymbolKind("method", "ja")).toBe("メソッド");
    expect(formatUnsupportedReason("parser_failed", "ja")).toBe("パーサー失敗");
    expect(formatArchitectureColumnLabel("upstream", "ja")).toBe("上流");
    expect(formatBusinessContextSourceType("github_issue", "ja")).toBe("GitHub Issue");
    expect(formatBusinessContextStatus("candidate", "ja")).toBe("候補");
    expect(workspaceCopyByLocale.ja.text.semanticFocus).toBe("注目点");
    expect(workspaceCopyByLocale.en.text.semanticSpanDelta).toBe("span delta");
  });
});
