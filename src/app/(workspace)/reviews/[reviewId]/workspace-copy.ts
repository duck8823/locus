export type WorkspaceLocale = "ja" | "en";

type ArchitectureRelation = "imports" | "calls" | "implements" | "uses";
type ArchitectureCategory = "layer" | "file" | "symbol" | "unknown";
type ArchitectureColumn = "upstream" | "downstream";
type SemanticSymbolKind = "function" | "method" | "class" | "module" | "unknown";
type ReviewGroupStatus = "unread" | "in_progress" | "reviewed";
type SemanticChangeType = "added" | "removed" | "modified" | "moved" | "renamed";
type UnsupportedFileReason = "unsupported_language" | "parser_failed" | "binary_file";

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
      architecturePane: "Architecture pane",
    },
    text: {
      noChangeGroupsYet: "No change groups are available yet.",
      changeGroupsWillAppear:
        "Initial analysis is in progress. Change groups will appear automatically.",
      noSemanticChangeDetails: "No semantic change details were recorded for this group.",
      changeGroupDetailsWillAppear:
        "Change group details will appear after semantic analysis produces the first review group.",
      whyThisExistsDescription:
        "This workspace is server-rendered from a persisted review session, so reopening keeps your progress and selected change group.",
      attempts: "Attempts",
      lastDuration: "Last duration",
      analysisQueued: "Queued. Starting review analysis…",
      analysisFetching: "Fetching pull request snapshots…",
      analysisParsing: "Parsing and grouping semantic changes",
      filesSuffix: "files",
      filesProcessedSuffix: "files processed",
      requestedAt: "Requested at",
      progress: "Progress",
      analysisReady: "Ready",
      readyAt: "Ready at",
      initialAnalysisFailed: "Initial analysis failed.",
      firstRunMayTakeLonger:
        "First run can take longer because no local cache is available yet. Keep this tab open and it will refresh automatically.",
      autoRefreshHint:
        "Auto-refresh runs while initial analysis or reanalysis is active, and pauses while this tab is in the background.",
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
      architectureScopeHint: "MVP v0 keeps this focused on immediate neighbors only.",
      noRelatedNodes: "No related nodes.",
      switchToRelatedGroup: "Switch to related change group",
      architectureContextWillAppear:
        "Architecture context will appear after the first change group is available.",
      analysisProgressAriaLabel: "Analysis progress",
      semanticKind: "kind",
      semanticSignature: "signature",
      semanticBody: "body",
      semanticBefore: "before",
      semanticAfter: "after",
    },
    actions: {
      markStatusPrefix: "Mark",
      queueReanalysis: "Queue reanalysis",
      queueingReanalysis: "Queueing...",
      reloadNow: "Reload now",
      refreshing: "Refreshing...",
      retryInitialAnalysis: "Retry initial analysis",
      retryingInitialAnalysis: "Retrying...",
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
      architecturePane: "アーキテクチャ",
    },
    text: {
      noChangeGroupsYet: "変更グループはまだありません。",
      changeGroupsWillAppear: "初回解析中です。完了すると変更グループが自動表示されます。",
      noSemanticChangeDetails: "このグループには詳細な差分情報がありません。",
      changeGroupDetailsWillAppear:
        "セマンティック解析で最初の変更グループが作成されると、ここに詳細が表示されます。",
      whyThisExistsDescription:
        "この画面は保存済みのレビューセッションをサーバー描画しているため、再表示しても進捗と選択中グループを保持できます。",
      attempts: "試行回数",
      lastDuration: "前回所要時間",
      analysisQueued: "キュー待機中です。レビュー解析を開始します…",
      analysisFetching: "Pull Request スナップショットを取得中…",
      analysisParsing: "セマンティック差分を解析・グルーピング中",
      filesSuffix: "ファイル",
      filesProcessedSuffix: "ファイル処理済み",
      requestedAt: "リクエスト時刻",
      progress: "進捗",
      analysisReady: "準備完了",
      readyAt: "準備完了時刻",
      initialAnalysisFailed: "初回解析に失敗しました。",
      firstRunMayTakeLonger:
        "初回はローカルキャッシュがないため時間がかかる場合があります。タブを開いたまま待つと自動更新されます。",
      autoRefreshHint:
        "初回解析または再解析が動作中は自動更新されます。タブが非アクティブな間は自動更新を一時停止します。",
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
      architectureScopeHint: "MVP v0 では直接の隣接ノードのみ表示します。",
      noRelatedNodes: "関連ノードはありません。",
      switchToRelatedGroup: "関連する変更グループに切り替える",
      architectureContextWillAppear:
        "最初の変更グループが利用可能になると、ここにアーキテクチャ情報が表示されます。",
      analysisProgressAriaLabel: "解析進捗",
      semanticKind: "種類",
      semanticSignature: "シグネチャ",
      semanticBody: "本文",
      semanticBefore: "変更前",
      semanticAfter: "変更後",
    },
    actions: {
      markStatusPrefix: "状態を",
      queueReanalysis: "再解析をキュー投入",
      queueingReanalysis: "キュー投入中...",
      reloadNow: "今すぐ再読み込み",
      refreshing: "再読み込み中...",
      retryInitialAnalysis: "初回解析を再試行",
      retryingInitialAnalysis: "再試行中...",
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
  },
} as const;

export type WorkspaceCopy = (typeof workspaceCopyByLocale)[WorkspaceLocale];

function normalizeLocaleToken(value: string | null | undefined): WorkspaceLocale | null {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  if (trimmed === "ja" || trimmed.startsWith("ja-")) {
    return "ja";
  }

  if (trimmed === "en" || trimmed.startsWith("en-")) {
    return "en";
  }

  return null;
}

function parseAcceptLanguageCandidates(
  acceptLanguage: string | null | undefined,
): Array<{ localeToken: string; quality: number; index: number }> {
  const entries = (acceptLanguage ?? "")
    .split(",")
    .map((entry, index) => {
      const [localeToken = "", ...params] = entry.split(";").map((part) => part.trim());
      const qualityParam = params.find((param) => param.toLowerCase().startsWith("q="));
      const parsedQuality = qualityParam ? Number(qualityParam.slice(2)) : 1;
      const quality =
        Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1
          ? parsedQuality
          : 1;

      return {
        localeToken,
        quality,
        index,
      };
    })
    .filter((candidate) => candidate.localeToken.length > 0);

  return entries.sort((left, right) => {
    if (right.quality !== left.quality) {
      return right.quality - left.quality;
    }

    return left.index - right.index;
  });
}

export function resolveWorkspaceLocale(input: {
  preferredLocale?: string | null;
  acceptLanguage?: string | null;
}): WorkspaceLocale {
  const preferredLocale = normalizeLocaleToken(input.preferredLocale);

  if (preferredLocale) {
    return preferredLocale;
  }

  const acceptedTokens = parseAcceptLanguageCandidates(input.acceptLanguage);

  for (const acceptedToken of acceptedTokens) {
    const normalized = normalizeLocaleToken(acceptedToken.localeToken);

    if (normalized) {
      return normalized;
    }
  }

  return "en";
}

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
