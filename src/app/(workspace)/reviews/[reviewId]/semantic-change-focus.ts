import type { WorkspaceLocale } from "@/app/(workspace)/workspace-locale";

interface CodeRegion {
  startLine: number;
  endLine: number;
}

export interface SemanticChangeFocusInput {
  locale: WorkspaceLocale;
  changeType: string;
  bodySummary: string | null;
  before: CodeRegion | null;
  after: CodeRegion | null;
}

export interface SemanticChangeFocusView {
  focusLabel: string;
  spanDeltaLabel: string | null;
}

function normalizeBodySummary(bodySummary: string | null): string {
  return (bodySummary ?? "").trim().toLowerCase();
}

function inferModifiedFocusKey(bodySummary: string): "contract" | "behavior" | "contract_and_behavior" | "updated" {
  if (bodySummary.includes("signature and body changed")) {
    return "contract_and_behavior";
  }

  if (bodySummary.includes("signature changed")) {
    return "contract";
  }

  if (bodySummary.includes("body changed")) {
    return "behavior";
  }

  return "updated";
}

function calculateSpanDelta(params: { before: CodeRegion | null; after: CodeRegion | null }): number | null {
  const beforeSpan =
    params.before && Number.isFinite(params.before.startLine) && Number.isFinite(params.before.endLine)
      ? Math.max(0, params.before.endLine - params.before.startLine + 1)
      : null;
  const afterSpan =
    params.after && Number.isFinite(params.after.startLine) && Number.isFinite(params.after.endLine)
      ? Math.max(0, params.after.endLine - params.after.startLine + 1)
      : null;

  if (beforeSpan === null && afterSpan === null) {
    return null;
  }

  return (afterSpan ?? 0) - (beforeSpan ?? 0);
}

function formatSpanDeltaLabel(delta: number | null, locale: WorkspaceLocale): string | null {
  if (delta === null) {
    return null;
  }

  if (delta === 0) {
    return locale === "ja" ? "行数差分なし" : "No span change";
  }

  if (locale === "ja") {
    return `${delta > 0 ? "+" : ""}${delta} 行`;
  }

  return `${delta > 0 ? "+" : ""}${delta} lines`;
}

function formatFocusLabel(params: {
  locale: WorkspaceLocale;
  changeType: string;
  bodySummary: string;
}): string {
  const isJapanese = params.locale === "ja";

  if (params.changeType === "added") {
    return isJapanese ? "新しい呼び出し可能要素が追加されました" : "A new callable was introduced";
  }

  if (params.changeType === "removed") {
    return isJapanese ? "呼び出し可能要素が削除されました" : "This callable was removed";
  }

  if (params.changeType === "moved") {
    return isJapanese ? "定義位置が移動しています" : "The callable moved to a different location";
  }

  if (params.changeType === "renamed") {
    return isJapanese ? "名称が変更されています" : "The callable name was updated";
  }

  const modifiedFocusKey = inferModifiedFocusKey(params.bodySummary);

  if (modifiedFocusKey === "contract_and_behavior") {
    return isJapanese
      ? "シグネチャ（契約）と実装の両方が変更されています"
      : "Both callable contract and behavior changed";
  }

  if (modifiedFocusKey === "contract") {
    return isJapanese
      ? "シグネチャ（契約）が変更されています"
      : "Callable contract (signature) changed";
  }

  if (modifiedFocusKey === "behavior") {
    return isJapanese ? "実装の振る舞いが変更されています" : "Callable behavior changed";
  }

  return isJapanese ? "実装内容が更新されています" : "Callable implementation was updated";
}

export function toSemanticChangeFocusView(input: SemanticChangeFocusInput): SemanticChangeFocusView {
  const normalizedBodySummary = normalizeBodySummary(input.bodySummary);
  const spanDelta = calculateSpanDelta({
    before: input.before,
    after: input.after,
  });

  return {
    focusLabel: formatFocusLabel({
      locale: input.locale,
      changeType: input.changeType,
      bodySummary: normalizedBodySummary,
    }),
    spanDeltaLabel: formatSpanDeltaLabel(spanDelta, input.locale),
  };
}
