import type { WorkspaceLocale } from "@/app/(workspace)/workspace-locale";

type ArchitectureRelation = "imports" | "calls" | "implements" | "uses";
type ArchitectureCategory = "layer" | "file" | "symbol" | "unknown";
type ArchitectureColumn = "upstream" | "downstream";
type SemanticSymbolKind = "function" | "method" | "class" | "module" | "unknown";
type ReviewGroupStatus = "unread" | "in_progress" | "reviewed";
type SemanticChangeType = "added" | "removed" | "modified" | "moved" | "renamed";
type UnsupportedFileReason = "unsupported_language" | "parser_failed" | "binary_file";
type AnalysisJobReason = "initial_ingestion" | "manual_reanalysis" | "code_host_webhook";
type AnalysisJobStatus = "queued" | "running" | "succeeded" | "failed";
type AiSuggestionCategory = "semantic" | "architecture" | "business" | "general";
type AiSuggestionConfidence = "high" | "medium" | "low";
type BusinessContextSourceType = "github_issue" | "confluence_page";
type BusinessContextStatus = "linked" | "candidate" | "unavailable";
type BusinessContextConfidence = "high" | "medium" | "low";
type BusinessContextInferenceSource =
  | "issue_url"
  | "repo_shorthand"
  | "same_repo_shorthand"
  | "same_repo_closing_keyword"
  | "branch_pattern"
  | "pull_request_fallback"
  | "none";

export const workspaceCopyByLocale = {
  en: {
    links: {
      backToHome: "← Back to home",
      connections: "Connections",
    },
    meta: {
      reviewer: "Reviewer",
      repository: "Repository",
      branch: "Branch",
      lastOpened: "Last opened",
    },
    section: {
      changeGroups: "Change groups",
      detailPane: "Detail pane",
      semanticChanges: "Semantic changes",
      whyThisExists: "Why this exists",
      initialAnalysis: "Initial analysis",
      reanalysisStatus: "Reanalysis status",
      analysisCoverage: "Analysis coverage",
      analysisJobs: "Analysis jobs",
      aiSuggestions: "AI suggestions",
      businessContext: "Business context",
      architecturePane: "Architecture pane",
    },
    text: {
      noChangeGroupsYet: "No change groups are available yet.",
      changeGroupsWillAppear:
        "Initial analysis is in progress. Change groups will appear automatically.",
      noSemanticChangeDetails: "No semantic change details were recorded for this group.",
      changeGroupDetailsWillAppear:
        "Details will appear after the first semantic-change group is ready.",
      whyThisExistsDescription:
        "This page is rendered from persisted review state, so your selected group and progress are restored.",
      attempts: "Attempts",
      lastDuration: "Last duration",
      analysisQueued: "Queued. Starting review analysis…",
      analysisFetching: "Fetching pull request snapshots…",
      analysisParsing: "Parsing and grouping semantic changes",
      filesSuffix: "files",
      filesProcessedSuffix: "files processed",
      requestedAt: "Requested at",
      queueAcceptedAt: "Queue accepted at",
      workerStartedAt: "Worker started at",
      trigger: "Trigger",
      progress: "Progress",
      analysisReady: "Ready",
      readyAt: "Ready at",
      initialAnalysisFailed: "Initial analysis failed.",
      firstRunMayTakeLonger:
        "First run may take longer while local cache is empty.",
      autoRefreshHint:
        "Auto-refresh runs only while analysis is active (paused in background tabs).",
      notRequestedYet: "Not requested yet",
      queuedSince: "Queued since",
      queuedOnly: "Queued…",
      runningSince: "Running since",
      runningOnly: "Running…",
      succeededAt: "Succeeded at",
      succeededOnly: "Succeeded",
      failedAt: "Failed at",
      failedOnly: "Failed",
      coverage: "Coverage",
      allFilesCovered: "All changed files were covered by active parser adapters.",
      excludedFiles: "file(s) were excluded from semantic analysis.",
      language: "language",
      unknownLanguage: "unknown",
      detail: "detail",
      showingFirstEntriesPrefix: "Showing first",
      showingFirstEntriesSuffix: "entries.",
      hiddenEntriesSuffix: "additional file(s) were omitted.",
      businessContextHint:
        "Phase 2 bridge: this panel shows requirement/spec links related to the current review.",
      noBusinessContextItems: "No requirement links were found.",
      businessContextStatus: "Status",
      businessContextSource: "Source",
      businessContextConfidence: "Confidence",
      businessContextInferenceSource: "Inference",
      architectureScopeHint: "MVP v0 shows only immediate neighbors.",
      noRelatedNodes: "No related nodes.",
      switchToRelatedGroup: "Switch to related change group",
      architectureContextWillAppear:
        "Architecture context will appear after the first change group is available.",
      analysisProgressAriaLabel: "Analysis progress",
      jobStatus: "Status",
      jobAttempts: "Attempts",
      jobDuration: "Duration",
      jobQueuedAt: "Queued at",
      noAnalysisJobsYet: "No analysis jobs recorded yet.",
      averageDuration: "Average duration",
      failureRate: "Failure rate",
      recoverySuccessRate: "Recovery success rate",
      noAiSuggestionsYet: "No AI suggestions yet.",
      aiSuggestionRationale: "Rationale",
      aiSuggestionCategory: "Category",
      aiSuggestionConfidence: "Confidence",
      aiDecisionAdopted: "Adopted",
      aiDecisionHolding: "On hold",
      aiDecisionNone: "Not decided",
      semanticKind: "kind",
      semanticSignature: "signature",
      semanticBody: "body",
      semanticBefore: "before",
      semanticAfter: "after",
      semanticFocus: "focus",
      semanticSpanDelta: "span delta",
      semanticLocationDetails: "location details",
      workspaceErrorWorkspaceNotFound:
        "The review workspace could not be found. Please reopen it from the home screen.",
      workspaceErrorSourceUnavailable:
        "Reanalysis source is unavailable. Reconnect GitHub OAuth and retry.",
      workspaceErrorActionFailed:
        "The request failed. Reload this page and try again.",
      workspaceErrorNextAction:
        "If the issue continues, check connection status and review logs.",
      businessContextFallback:
        "Business context could not be loaded. Showing fallback snapshot.",
      businessContextFallbackRetryHint:
        "Use Reload now to retry context loading.",
    },
    actions: {
      markStatusPrefix: "Mark",
      languageLabel: "Language",
      switchToEnglish: "English",
      switchToJapanese: "日本語",
      queueReanalysis: "Queue reanalysis",
      queueingReanalysis: "Queueing...",
      reloadNow: "Reload now",
      refreshing: "Refreshing...",
      retryInitialAnalysis: "Retry initial analysis",
      retryingInitialAnalysis: "Retrying...",
      adoptSuggestion: "Adopt",
      holdSuggestion: "Hold",
      clearSuggestionDecision: "Clear",
    },
    reviewGroupStatus: {
      unread: "Unread",
      in_progress: "In progress",
      reviewed: "Reviewed",
    },
    semanticChangeType: {
      added: "Added",
      removed: "Removed",
      modified: "Modified",
      moved: "Moved",
      renamed: "Renamed",
    },
    semanticSymbolKind: {
      function: "function",
      method: "method",
      class: "class",
      module: "module",
      unknown: "unknown",
    },
    unsupportedReason: {
      unsupported_language: "Unsupported language",
      parser_failed: "Parser failed",
      binary_file: "Binary file",
    },
    architecture: {
      relation: {
        imports: "imports",
        calls: "calls",
        implements: "implements",
        uses: "uses",
      },
      category: {
        layer: "Layers",
        file: "Files",
        symbol: "Symbols",
        unknown: "Others",
      },
      column: {
        upstream: "Upstream",
        downstream: "Downstream",
      },
    },
    analysisJobReason: {
      initial_ingestion: "Initial ingestion",
      manual_reanalysis: "Manual reanalysis",
      code_host_webhook: "Webhook ingestion",
    },
    analysisJobStatus: {
      queued: "Queued",
      running: "Running",
      succeeded: "Succeeded",
      failed: "Failed",
    },
    aiSuggestionCategory: {
      semantic: "Semantic",
      architecture: "Architecture",
      business: "Business",
      general: "General",
    },
    aiSuggestionConfidence: {
      high: "High",
      medium: "Medium",
      low: "Low",
    },
    businessContextSourceType: {
      github_issue: "GitHub Issue",
      confluence_page: "Confluence Page",
    },
    businessContextStatus: {
      linked: "Linked",
      candidate: "Candidate",
      unavailable: "Unavailable",
    },
    businessContextConfidence: {
      high: "High",
      medium: "Medium",
      low: "Low",
    },
    businessContextInferenceSource: {
      issue_url: "Issue URL",
      repo_shorthand: "owner/repo#issue",
      same_repo_shorthand: "#issue shorthand",
      same_repo_closing_keyword: "closing keyword",
      branch_pattern: "branch pattern",
      pull_request_fallback: "PR fallback",
      none: "none",
    },
  },
  ja: {
    links: {
      backToHome: "← ホームへ戻る",
      connections: "接続設定",
    },
    meta: {
      reviewer: "レビュアー",
      repository: "リポジトリ",
      branch: "ブランチ",
      lastOpened: "最終表示",
    },
    section: {
      changeGroups: "変更グループ",
      detailPane: "詳細",
      semanticChanges: "セマンティック差分",
      whyThisExists: "この画面の意図",
      initialAnalysis: "初回解析",
      reanalysisStatus: "再解析ステータス",
      analysisCoverage: "解析カバレッジ",
      analysisJobs: "解析ジョブ",
      aiSuggestions: "AI提案",
      businessContext: "ビジネスコンテキスト",
      architecturePane: "アーキテクチャ",
    },
    text: {
      noChangeGroupsYet: "変更グループはまだありません。",
      changeGroupsWillAppear: "初回解析中です。完了すると変更グループが自動表示されます。",
      noSemanticChangeDetails: "このグループには詳細な差分情報がありません。",
      changeGroupDetailsWillAppear:
        "最初の変更グループが作成されると、ここに詳細を表示します。",
      whyThisExistsDescription:
        "保存済みレビュー状態から描画するため、再表示しても選択中グループと進捗を保持します。",
      attempts: "試行回数",
      lastDuration: "前回所要時間",
      analysisQueued: "キュー待機中です。レビュー解析を開始します…",
      analysisFetching: "Pull Request スナップショットを取得中…",
      analysisParsing: "セマンティック差分を解析・グルーピング中",
      filesSuffix: "ファイル",
      filesProcessedSuffix: "ファイル処理済み",
      requestedAt: "リクエスト時刻",
      queueAcceptedAt: "キュー受理時刻",
      workerStartedAt: "ワーカー開始時刻",
      trigger: "トリガー",
      progress: "進捗",
      analysisReady: "準備完了",
      readyAt: "準備完了時刻",
      initialAnalysisFailed: "初回解析に失敗しました。",
      firstRunMayTakeLonger:
        "初回はローカルキャッシュがないため時間がかかる場合があります。",
      autoRefreshHint:
        "解析中のみ自動更新します（非アクティブタブでは一時停止）。",
      notRequestedYet: "未リクエスト",
      queuedSince: "キュー投入時刻",
      queuedOnly: "キュー待機中…",
      runningSince: "実行開始時刻",
      runningOnly: "実行中…",
      succeededAt: "成功時刻",
      succeededOnly: "成功",
      failedAt: "失敗時刻",
      failedOnly: "失敗",
      coverage: "カバレッジ",
      allFilesCovered: "変更ファイルはすべて有効なパーサーで解析できました。",
      excludedFiles: "ファイルはセマンティック解析対象外でした。",
      language: "言語",
      unknownLanguage: "不明",
      detail: "詳細",
      showingFirstEntriesPrefix: "先頭",
      showingFirstEntriesSuffix: "件を表示中。",
      hiddenEntriesSuffix: "件は省略しています。",
      businessContextHint:
        "Phase 2 ブリッジとして、このレビューに関連する要件/仕様リンクを表示します。",
      noBusinessContextItems: "関連する要件リンクは見つかりませんでした。",
      businessContextStatus: "状態",
      businessContextSource: "ソース",
      businessContextConfidence: "確信度",
      businessContextInferenceSource: "推定根拠",
      architectureScopeHint: "MVP v0 は直接の隣接ノードのみ表示します。",
      noRelatedNodes: "関連ノードはありません。",
      switchToRelatedGroup: "関連する変更グループに切り替える",
      architectureContextWillAppear:
        "最初の変更グループが利用可能になると、ここにアーキテクチャ情報が表示されます。",
      analysisProgressAriaLabel: "解析進捗",
      jobStatus: "状態",
      jobAttempts: "試行回数",
      jobDuration: "所要時間",
      jobQueuedAt: "キュー投入",
      noAnalysisJobsYet: "解析ジョブ履歴はまだありません。",
      averageDuration: "平均所要時間",
      failureRate: "失敗率",
      recoverySuccessRate: "復帰成功率",
      noAiSuggestionsYet: "AI提案はまだありません。",
      aiSuggestionRationale: "根拠",
      aiSuggestionCategory: "カテゴリ",
      aiSuggestionConfidence: "確信度",
      aiDecisionAdopted: "採用済み",
      aiDecisionHolding: "保留中",
      aiDecisionNone: "未判断",
      semanticKind: "種類",
      semanticSignature: "シグネチャ",
      semanticBody: "本文",
      semanticBefore: "変更前",
      semanticAfter: "変更後",
      semanticFocus: "注目点",
      semanticSpanDelta: "行数差分",
      semanticLocationDetails: "位置情報",
      workspaceErrorWorkspaceNotFound:
        "レビュー画面が見つかりません。ホーム画面から開き直してください。",
      workspaceErrorSourceUnavailable:
        "再解析元が利用できません。GitHub OAuth を再接続して再試行してください。",
      workspaceErrorActionFailed:
        "リクエストに失敗しました。ページを再読み込みして再実行してください。",
      workspaceErrorNextAction:
        "継続する場合は接続状態とログを確認してください。",
      businessContextFallback:
        "ビジネスコンテキストの取得に失敗したため、フォールバックスナップショットを表示しています。",
      businessContextFallbackRetryHint:
        "「今すぐ再読み込み」で再取得できます。",
    },
    actions: {
      markStatusPrefix: "状態を",
      languageLabel: "表示言語",
      switchToEnglish: "English",
      switchToJapanese: "日本語",
      queueReanalysis: "再解析をキュー投入",
      queueingReanalysis: "キュー投入中...",
      reloadNow: "今すぐ再読み込み",
      refreshing: "再読み込み中...",
      retryInitialAnalysis: "初回解析を再試行",
      retryingInitialAnalysis: "再試行中...",
      adoptSuggestion: "採用",
      holdSuggestion: "保留",
      clearSuggestionDecision: "解除",
    },
    reviewGroupStatus: {
      unread: "未確認",
      in_progress: "確認中",
      reviewed: "確認済み",
    },
    semanticChangeType: {
      added: "追加",
      removed: "削除",
      modified: "変更",
      moved: "移動",
      renamed: "改名",
    },
    semanticSymbolKind: {
      function: "関数",
      method: "メソッド",
      class: "クラス",
      module: "モジュール",
      unknown: "不明",
    },
    unsupportedReason: {
      unsupported_language: "未対応言語",
      parser_failed: "パーサー失敗",
      binary_file: "バイナリファイル",
    },
    architecture: {
      relation: {
        imports: "import",
        calls: "call",
        implements: "implements",
        uses: "use",
      },
      category: {
        layer: "レイヤー",
        file: "ファイル",
        symbol: "シンボル",
        unknown: "その他",
      },
      column: {
        upstream: "上流",
        downstream: "下流",
      },
    },
    analysisJobReason: {
      initial_ingestion: "初回取り込み",
      manual_reanalysis: "手動再解析",
      code_host_webhook: "Webhook 取り込み",
    },
    analysisJobStatus: {
      queued: "キュー待機",
      running: "実行中",
      succeeded: "成功",
      failed: "失敗",
    },
    aiSuggestionCategory: {
      semantic: "セマンティック",
      architecture: "アーキテクチャ",
      business: "ビジネス",
      general: "一般",
    },
    aiSuggestionConfidence: {
      high: "高",
      medium: "中",
      low: "低",
    },
    businessContextSourceType: {
      github_issue: "GitHub Issue",
      confluence_page: "Confluence ページ",
    },
    businessContextStatus: {
      linked: "連携済み",
      candidate: "候補",
      unavailable: "未連携",
    },
    businessContextConfidence: {
      high: "高",
      medium: "中",
      low: "低",
    },
    businessContextInferenceSource: {
      issue_url: "Issue URL参照",
      repo_shorthand: "owner/repo#issue 記法",
      same_repo_shorthand: "同一リポジトリ #issue 記法",
      same_repo_closing_keyword: "close/fix/resolve 記法",
      branch_pattern: "ブランチ名規約",
      pull_request_fallback: "PR情報フォールバック",
      none: "推定なし",
    },
  },
} as const;

export type WorkspaceCopy = (typeof workspaceCopyByLocale)[WorkspaceLocale];

export function formatReviewGroupStatus(
  status: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.reviewGroupStatus[status as ReviewGroupStatus] ??
    status.replaceAll("_", " ")
  );
}

export function formatMarkStatusAction(
  status: string,
  locale: WorkspaceLocale,
): string {
  const statusLabel = formatReviewGroupStatus(status, locale);

  if (locale === "ja") {
    return `${statusLabel}にする`;
  }

  return `${workspaceCopyByLocale.en.actions.markStatusPrefix} ${statusLabel}`;
}

export function formatSemanticChangeType(
  changeType: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.semanticChangeType[changeType as SemanticChangeType] ??
    changeType.replaceAll("_", " ")
  );
}

export function formatSemanticSymbolKind(
  symbolKind: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.semanticSymbolKind[symbolKind as SemanticSymbolKind] ??
    symbolKind.replaceAll("_", " ")
  );
}

export function formatUnsupportedReason(
  reason: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.unsupportedReason[reason as UnsupportedFileReason] ??
    reason.replaceAll("_", " ")
  );
}

export function formatArchitectureRelation(
  relation: ArchitectureRelation,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return copy.architecture.relation[relation];
}

export function formatArchitectureCategoryLabel(
  category: ArchitectureCategory,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return copy.architecture.category[category];
}

export function formatArchitectureColumnLabel(
  column: ArchitectureColumn,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return copy.architecture.column[column];
}

export function formatAnalysisJobReason(
  reason: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.analysisJobReason[reason as AnalysisJobReason] ??
    reason.replaceAll("_", " ")
  );
}

export function formatAnalysisJobStatus(
  status: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.analysisJobStatus[status as AnalysisJobStatus] ??
    status.replaceAll("_", " ")
  );
}

export function formatAiSuggestionCategory(
  category: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.aiSuggestionCategory[category as AiSuggestionCategory] ??
    category.replaceAll("_", " ")
  );
}

export function formatAiSuggestionConfidence(
  confidence: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.aiSuggestionConfidence[confidence as AiSuggestionConfidence] ??
    confidence.replaceAll("_", " ")
  );
}

export function formatBusinessContextSourceType(
  sourceType: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.businessContextSourceType[sourceType as BusinessContextSourceType] ??
    sourceType.replaceAll("_", " ")
  );
}

export function formatBusinessContextStatus(
  status: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.businessContextStatus[status as BusinessContextStatus] ??
    status.replaceAll("_", " ")
  );
}

export function formatBusinessContextConfidence(
  confidence: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.businessContextConfidence[confidence as BusinessContextConfidence] ??
    confidence.replaceAll("_", " ")
  );
}

export function formatBusinessContextInferenceSource(
  inferenceSource: string,
  locale: WorkspaceLocale,
): string {
  const copy = workspaceCopyByLocale[locale];
  return (
    copy.businessContextInferenceSource[inferenceSource as BusinessContextInferenceSource] ??
    inferenceSource.replaceAll("_", " ")
  );
}

const DEMO_WORKSPACE_TITLE_EN = "Demo semantic review workspace";
const DEMO_WORKSPACE_TITLE_JA = "セマンティックレビュー・デモワークスペース";
const SEMANTIC_GROUP_TITLE_SUFFIX_EN = " semantic changes";
const SEMANTIC_GROUP_TITLE_SUFFIX_JA = " のセマンティック差分";
const NO_SEMANTIC_CHANGES_DETECTED_EN = "No semantic changes detected.";
const NO_SEMANTIC_CHANGES_DETECTED_JA = "セマンティック差分は検出されませんでした。";

const SEMANTIC_BODY_SUMMARY_JA_BY_EN = {
  "Callable added": "呼び出し可能要素が追加されました",
  "Callable removed": "呼び出し可能要素が削除されました",
  "Body changed": "実装本体が変更されました",
  "Signature changed": "シグネチャが変更されました",
  "Signature and body changed": "シグネチャと実装本体の両方が変更されました",
} as const;

const BUSINESS_CONTEXT_TITLE_JA_BY_EN = {
  "No GitHub issue context is linked yet": "GitHub Issue コンテキストはまだ紐づいていません",
  "No Confluence page linked": "Confluence ページは未連携です",
  "Business context temporarily unavailable": "ビジネスコンテキストを一時的に取得できません",
} as const;

const BUSINESS_CONTEXT_SUMMARY_JA_BY_EN = {
  "Issue context requires a GitHub-hosted review source.":
    "Issue コンテキストは GitHub 由来のレビューソースで利用できます。",
  "Confluence linking is intentionally deferred; this panel defines the future contract.":
    "Confluence 連携は後続フェーズで対応予定です。このパネルでは将来契約を確認できます。",
  "Failed to load context provider output. Retry is available.":
    "コンテキストプロバイダーの取得に失敗しました。再試行できます。",
} as const;

type KnownSuggestionId =
  | "verify-removed-symbol-references"
  | "check-downstream-callers"
  | "review-input-validation"
  | "trace-requirement-context"
  | "baseline-manual-review";

const AI_SUGGESTION_TEXT_JA_BY_ID: Record<
  KnownSuggestionId,
  {
    headline: string;
    recommendation: string;
  }
> = {
  "verify-removed-symbol-references": {
    headline: "削除されたシンボルの呼び出し元を確認",
    recommendation:
      "削除されたシンボルが検出されました。直接/間接の呼び出し元が削除・移行済みか、または feature flag で保護されているか確認してください。",
  },
  "check-downstream-callers": {
    headline: "下流の挙動変化をレビュー",
    recommendation:
      "変更されたシンボルに下流依存があります。呼び出し側と契約前提の退行リスクを確認してください。",
  },
  "review-input-validation": {
    headline: "新規経路のバリデーションと境界値を確認",
    recommendation:
      "新しい呼び出し可能要素が追加されました。境界条件・不正入力・認証/認可の前提を確認してください。",
  },
  "trace-requirement-context": {
    headline: "要件コンテキストへのトレーサビリティを確認",
    recommendation:
      "関連する要件コンテキストと照合し、受け入れ条件がテストでカバーされているか確認してください。",
  },
  "baseline-manual-review": {
    headline: "高シグナルのヒューリスティックは検出されませんでした",
    recommendation:
      "ベースライン確認を実施してください: API互換性、テストカバレッジ差分、エラーハンドリング、セキュリティ影響のあるデータフロー。",
  },
};

const AI_SUGGESTION_RATIONALE_LINE_JA_BY_EN = {
  "No semantic changes were found for the selected group.":
    "選択中グループではセマンティック差分が見つかりませんでした。",
  "Semantic context was limited.": "セマンティックコンテキストが限定的でした。",
  "Architecture context was limited.": "アーキテクチャコンテキストが限定的でした。",
  "Business context was limited.": "ビジネスコンテキストが限定的でした。",
} as const;

const AI_RATIONALE_PREFIX_JA_BY_EN = {
  "Removed: ": "削除: ",
  "Added: ": "追加: ",
  "Modified: ": "変更: ",
  "Location: ": "位置: ",
  "Signature: ": "シグネチャ: ",
  "Architecture downstream count: ": "下流ノード数: ",
  "Downstream neighbors: ": "下流隣接ノード数: ",
  "Representative symbols: ": "代表シンボル: ",
  "Context: ": "コンテキスト: ",
  "Source: ": "ソース: ",
  "Confidence: ": "確信度: ",
} as const;

function replaceByPrefix(input: string, prefix: string, replacementPrefix: string): string {
  if (!input.startsWith(prefix)) {
    return input;
  }

  return `${replacementPrefix}${input.slice(prefix.length)}`;
}

function localizeAiSuggestionRationaleLine(line: string, locale: WorkspaceLocale): string {
  if (locale !== "ja") {
    return line;
  }

  const mappedLine =
    AI_SUGGESTION_RATIONALE_LINE_JA_BY_EN[
      line as keyof typeof AI_SUGGESTION_RATIONALE_LINE_JA_BY_EN
    ];

  if (mappedLine) {
    return mappedLine;
  }

  const matchedPrefixEntry = Object.entries(AI_RATIONALE_PREFIX_JA_BY_EN).find(([prefix]) =>
    line.startsWith(prefix),
  );

  if (!matchedPrefixEntry) {
    return line;
  }

  const [prefix, replacementPrefix] = matchedPrefixEntry;
  return replaceByPrefix(line, prefix, replacementPrefix);
}

export function formatWorkspaceTitle(title: string, locale: WorkspaceLocale): string {
  if (locale === "ja" && title === DEMO_WORKSPACE_TITLE_EN) {
    return DEMO_WORKSPACE_TITLE_JA;
  }

  return title;
}

export function formatReviewGroupTitle(title: string, locale: WorkspaceLocale): string {
  if (
    locale === "ja" &&
    title.endsWith(SEMANTIC_GROUP_TITLE_SUFFIX_EN) &&
    title.length > SEMANTIC_GROUP_TITLE_SUFFIX_EN.length
  ) {
    return `${title.slice(0, -SEMANTIC_GROUP_TITLE_SUFFIX_EN.length)}${SEMANTIC_GROUP_TITLE_SUFFIX_JA}`;
  }

  return title;
}

export function formatReviewGroupSummary(summary: string, locale: WorkspaceLocale): string {
  if (locale === "ja" && summary === NO_SEMANTIC_CHANGES_DETECTED_EN) {
    return NO_SEMANTIC_CHANGES_DETECTED_JA;
  }

  return summary;
}

export function formatSemanticBodySummary(
  bodySummary: string | null,
  locale: WorkspaceLocale,
): string | null {
  if (bodySummary === null || locale !== "ja") {
    return bodySummary;
  }

  return (
    SEMANTIC_BODY_SUMMARY_JA_BY_EN[
      bodySummary as keyof typeof SEMANTIC_BODY_SUMMARY_JA_BY_EN
    ] ?? bodySummary
  );
}

export function localizeAiSuggestionText(input: {
  locale: WorkspaceLocale;
  suggestionId: string;
  headline: string;
  recommendation: string;
  rationale: string[];
}): {
  headline: string;
  recommendation: string;
  rationale: string[];
} {
  if (input.locale !== "ja") {
    return {
      headline: input.headline,
      recommendation: input.recommendation,
      rationale: input.rationale,
    };
  }

  const localized = AI_SUGGESTION_TEXT_JA_BY_ID[input.suggestionId as KnownSuggestionId];

  return {
    headline: localized?.headline ?? input.headline,
    recommendation: localized?.recommendation ?? input.recommendation,
    rationale: input.rationale.map((line) => localizeAiSuggestionRationaleLine(line, input.locale)),
  };
}

export function formatBusinessContextTitle(title: string, locale: WorkspaceLocale): string {
  if (locale !== "ja") {
    return title;
  }

  return (
    BUSINESS_CONTEXT_TITLE_JA_BY_EN[
      title as keyof typeof BUSINESS_CONTEXT_TITLE_JA_BY_EN
    ] ?? title
  );
}

export function formatBusinessContextSummary(
  summary: string | null,
  locale: WorkspaceLocale,
): string | null {
  if (summary === null || locale !== "ja") {
    return summary;
  }

  return (
    BUSINESS_CONTEXT_SUMMARY_JA_BY_EN[
      summary as keyof typeof BUSINESS_CONTEXT_SUMMARY_JA_BY_EN
    ] ?? summary
  );
}
