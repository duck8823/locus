import { describe, expect, it } from "vitest";
import {
  workspaceCopyByLocale,
  formatArchitectureColumnLabel,
  formatAiSuggestionCategory,
  formatAiSuggestionConfidence,
  formatAnalysisJobStatus,
  formatBusinessContextConfidence,
  formatBusinessContextInferenceSource,
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
    expect(formatAnalysisJobStatus("running", "ja")).toBe("実行中");
    expect(formatAiSuggestionCategory("architecture", "ja")).toBe("アーキテクチャ");
    expect(formatAiSuggestionConfidence("medium", "ja")).toBe("中");
    expect(formatBusinessContextConfidence("high", "ja")).toBe("高");
    expect(formatBusinessContextInferenceSource("branch_pattern", "ja")).toBe("ブランチ規約");
    expect(workspaceCopyByLocale.ja.text.semanticFocus).toBe("注目点");
    expect(workspaceCopyByLocale.en.text.semanticSpanDelta).toBe("span delta");
    expect(workspaceCopyByLocale.ja.text.semanticLocationDetails).toBe("位置情報");
  });
});
