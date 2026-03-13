import { describe, expect, it } from "vitest";
import {
  formatBusinessContextSummary,
  formatBusinessContextTitle,
  workspaceCopyByLocale,
  formatAiSuggestionCategory,
  formatAiSuggestionConfidence,
  formatAnalysisJobStatus,
  formatArchitectureColumnLabel,
  formatBusinessContextConfidence,
  formatBusinessContextInferenceSource,
  formatBusinessContextSourceType,
  formatBusinessContextStatus,
  formatReviewGroupSummary,
  formatReviewGroupTitle,
  formatReviewGroupStatus,
  formatSemanticBodySummary,
  formatSemanticChangeType,
  formatSemanticSymbolKind,
  formatWorkspaceTitle,
  localizeAiSuggestionText,
  formatUnsupportedReason,
} from "./workspace-copy";

describe("workspace-copy", () => {
  it("formats review-group and semantic labels in japanese", () => {
    expect(formatReviewGroupStatus("in_progress", "ja")).toBe("確認中");
    expect(formatSemanticChangeType("renamed", "ja")).toBe("改名");
    expect(formatSemanticSymbolKind("method", "ja")).toBe("メソッド");
    expect(formatUnsupportedReason("parser_failed", "ja")).toBe("パーサー失敗");
    expect(formatArchitectureColumnLabel("upstream", "ja")).toBe("上流");
    expect(formatAnalysisJobStatus("running", "ja")).toBe("実行中");
    expect(formatAiSuggestionCategory("architecture", "ja")).toBe("アーキテクチャ");
    expect(formatAiSuggestionConfidence("medium", "ja")).toBe("中");
    expect(formatBusinessContextSourceType("github_issue", "ja")).toBe("GitHub Issue");
    expect(formatBusinessContextStatus("candidate", "ja")).toBe("候補");
    expect(formatBusinessContextConfidence("high", "ja")).toBe("高");
    expect(formatBusinessContextInferenceSource("branch_pattern", "ja")).toBe("ブランチ名規約");
    expect(formatBusinessContextInferenceSource("same_repo_shorthand", "ja")).toBe(
      "同一リポジトリ #issue 記法",
    );
    expect(workspaceCopyByLocale.ja.text.semanticFocus).toBe("注目点");
    expect(workspaceCopyByLocale.en.text.semanticSpanDelta).toBe("span delta");
    expect(workspaceCopyByLocale.ja.text.semanticLocationDetails).toBe("位置情報");
    expect(workspaceCopyByLocale.en.text.analysisHintSummary).toBe("Auto-refresh details");
    expect(workspaceCopyByLocale.ja.text.analysisHintSummary).toBe("自動更新の補足");
    expect(workspaceCopyByLocale.en.text.businessContextHintSummary).toBe(
      "How links are inferred",
    );
    expect(workspaceCopyByLocale.ja.text.businessContextHintSummary).toBe("リンク推定の補足");
  });

  it("localizes known generated workspace text in japanese", () => {
    expect(formatWorkspaceTitle("Demo semantic review workspace", "ja")).toBe(
      "セマンティックレビュー・デモワークスペース",
    );
    expect(
      formatReviewGroupTitle("src/core/email-validator.ts semantic changes", "ja"),
    ).toBe("src/core/email-validator.ts のセマンティック差分");
    expect(formatReviewGroupSummary("No semantic changes detected.", "ja")).toBe(
      "セマンティック差分は検出されませんでした。",
    );
    expect(formatSemanticBodySummary("Body changed", "ja")).toBe(
      "実装本体が変更されました",
    );
  });

  it("localizes AI suggestion content for known suggestion ids", () => {
    const localized = localizeAiSuggestionText({
      locale: "ja",
      suggestionId: "check-downstream-callers",
      headline: "Review downstream behavior changes",
      recommendation:
        "The modified symbol has downstream dependencies. Validate regression risk for callers and contract assumptions.",
      rationale: [
        "Modified: updateProfile",
        "Downstream neighbors: 4",
        "Representative symbols: updateProfile, notifyOwner",
      ],
    });

    expect(localized.headline).toBe("下流の挙動変化をレビュー");
    expect(localized.recommendation).toContain("下流依存");
    expect(localized.rationale).toEqual([
      "変更: updateProfile",
      "下流隣接ノード数: 4",
      "代表シンボル: updateProfile, notifyOwner",
    ]);
  });

  it("localizes known business context placeholder copy in japanese", () => {
    expect(
      formatBusinessContextTitle("No GitHub issue context is linked yet", "ja"),
    ).toBe("GitHub Issue コンテキストはまだ紐づいていません");
    expect(
      formatBusinessContextSummary(
        "Confluence linking is intentionally deferred; this panel defines the future contract.",
        "ja",
      ),
    ).toContain("Confluence 連携は後続フェーズで対応予定");
    expect(workspaceCopyByLocale.ja.text.businessContextFallback).toContain(
      "ビジネスコンテキストの取得に失敗",
    );
  });
});
