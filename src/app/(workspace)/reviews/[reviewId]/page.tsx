import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "./page.module.css";
import { AnalysisManualRefreshButton } from "./analysis-manual-refresh-button";
import { AnalysisStatusPoller } from "./analysis-status-poller";
import { InitialAnalysisRetrySubmitButton } from "./initial-analysis-retry-submit-button";
import { CollapsibleDetails } from "./collapsible-details";
import { ReanalyzeSubmitButton } from "./reanalyze-submit-button";
import { toSemanticChangeFocusView } from "./semantic-change-focus";
import { AiSuggestionPanel } from "./ai-suggestion-panel";
import {
  formatAnalysisJobReason,
  formatAnalysisJobStatus,
  formatArchitectureCategoryLabel,
  formatArchitectureColumnLabel,
  formatBusinessContextSummary,
  formatBusinessContextTitle,
  formatBusinessContextConfidence,
  formatBusinessContextInferenceSource,
  formatArchitectureRelation,
  formatBusinessContextSourceType,
  formatBusinessContextStatus,
  formatMarkStatusAction,
  formatReviewGroupSummary,
  formatReviewGroupTitle,
  formatReviewGroupStatus,
  formatSemanticBodySummary,
  formatSemanticChangeType,
  formatSemanticSymbolKind,
  formatUnsupportedReason,
  formatWorkspaceTitle,
  workspaceCopyByLocale,
} from "./workspace-copy";
import { resolveWorkspaceLocale } from "@/app/(workspace)/workspace-locale";
import { LocalizedDateTime } from "@/app/components/localized-date-time";
import { loadReviewWorkspaceDto } from "@/server/presentation/api/load-review-workspace";
import {
  createAnalysisStatusToken,
  isActiveAnalysisStatus,
} from "@/server/presentation/formatters/analysis-status-token";
import { requestInitialAnalysisRetryAction } from "@/server/presentation/actions/request-initial-analysis-retry-action";
import { requestReanalysisAction } from "@/server/presentation/actions/request-reanalysis-action";
import { selectReviewGroupAction } from "@/server/presentation/actions/select-review-group-action";
import { setWorkspaceLocaleAction } from "@/server/presentation/actions/set-workspace-locale-action";
import { setReviewGroupStatusAction } from "@/server/presentation/actions/set-review-group-status-action";
import { DEMO_VIEWER_COOKIE_NAME } from "@/server/presentation/actions/demo-viewer-cookie-name";
import { parseWorkspaceErrorCode } from "@/server/presentation/actions/workspace-error-code";
import {
  groupArchitectureNodes,
  type ArchitectureNodeGroups,
} from "@/server/presentation/formatters/architecture-node";

function formatCodeRegion(
  region: { filePath: string; startLine: number; endLine: number } | null,
): string {
  if (!region) {
    return "—";
  }

  return `${region.filePath}:${region.startLine}-${region.endLine}`;
}

function formatAnalysisDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}


function formatCoveragePercent(coveragePercent: number): string {
  const formatted = coveragePercent.toFixed(1);

  return formatted.endsWith(".0") ? `${formatted.slice(0, -2)}%` : `${formatted}%`;
}

function formatNullablePercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const formatted = value.toFixed(1);
  return formatted.endsWith(".0") ? `${formatted.slice(0, -2)}%` : `${formatted}%`;
}

function compactTextItems(items: Array<string | null | undefined>): string[] {
  return items.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function calculateAnalysisProgressPercent(params: {
  analysisProcessedFiles: number | null;
  analysisTotalFiles: number | null;
}): number | null {
  const totalFiles = params.analysisTotalFiles;
  const processedFiles = params.analysisProcessedFiles;

  if (
    typeof totalFiles !== "number" ||
    !Number.isFinite(totalFiles) ||
    totalFiles <= 0 ||
    typeof processedFiles !== "number" ||
    !Number.isFinite(processedFiles) ||
    processedFiles < 0
  ) {
    return null;
  }

  const boundedProcessedFiles = Math.min(processedFiles, totalFiles);
  const rawPercent = (boundedProcessedFiles / totalFiles) * 100;
  return Math.floor(rawPercent * 10) / 10;
}

const ARCHITECTURE_CATEGORY_FLAGS: Record<keyof ArchitectureNodeGroups, true> = {
  layer: true,
  file: true,
  symbol: true,
  unknown: true,
};
const ARCHITECTURE_CATEGORY_ORDER = Object.keys(
  ARCHITECTURE_CATEGORY_FLAGS,
) as Array<keyof ArchitectureNodeGroups>;
interface ArchitectureColumn {
  label: "upstream" | "downstream";
  nodes: Array<{
    nodeId: string;
    linkedGroupId: string | null;
  }>;
  relationByNodeId: Map<string, "imports" | "calls" | "implements" | "uses">;
}

export default async function ReviewWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ reviewId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reviewId } = await params;
  const resolvedSearchParams = await searchParams;
  const headerStore = await headers();
  const cookieStore = await cookies();
  const viewerName = cookieStore.get(DEMO_VIEWER_COOKIE_NAME)?.value;
  const workspaceLocale = resolveWorkspaceLocale({
    preferredLocale: cookieStore.get("locus-ui-locale")?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });
  const copy = workspaceCopyByLocale[workspaceLocale];
  const workspaceErrorCode = parseWorkspaceErrorCode(
    typeof resolvedSearchParams.workspaceError === "string"
      ? resolvedSearchParams.workspaceError
      : null,
  );
  const workspaceErrorMessage =
    workspaceErrorCode === "workspace_not_found"
      ? copy.text.workspaceErrorWorkspaceNotFound
      : workspaceErrorCode === "source_unavailable"
        ? copy.text.workspaceErrorSourceUnavailable
        : workspaceErrorCode === "action_failed"
          ? copy.text.workspaceErrorActionFailed
          : null;

  if (!viewerName) {
    redirect("/");
  }

  const workspace = await loadReviewWorkspaceDto({ reviewId });
  const selectedGroup =
    workspace.groups.find((group) => group.isSelected) ?? workspace.groups[0];
  const isInitialAnalysisRunning = isActiveAnalysisStatus(workspace.analysisStatus);
  const analysisProgressPercent = calculateAnalysisProgressPercent({
    analysisProcessedFiles: workspace.analysisProcessedFiles,
    analysisTotalFiles: workspace.analysisTotalFiles,
  });
  const analysisStatusToken = createAnalysisStatusToken({
    analysisStatus: workspace.analysisStatus,
    analysisRequestedAt: workspace.analysisRequestedAt,
    analysisCompletedAt: workspace.analysisCompletedAt,
    analysisProcessedFiles: workspace.analysisProcessedFiles,
    analysisTotalFiles: workspace.analysisTotalFiles,
    analysisAttemptCount: workspace.analysisAttemptCount,
    analysisError: workspace.analysisError,
    reanalysisStatus: workspace.reanalysisStatus,
    lastReanalyzeRequestedAt: workspace.lastReanalyzeRequestedAt,
    lastReanalyzeCompletedAt: workspace.lastReanalyzeCompletedAt,
    lastReanalyzeError: workspace.lastReanalyzeError,
  });
  const hiddenUnsupportedFileCount =
    Math.max(0, workspace.analysisUnsupportedFiles - workspace.unsupportedFiles.length);
  const architectureColumns: ArchitectureColumn[] = selectedGroup
    ? (() => {
        const nodeById = new Map(
          selectedGroup.architectureGraph.nodes.map((node) => [node.nodeId, node] as const),
        );
        const centerNodeId =
          selectedGroup.architectureGraph.nodes.find((node) => node.role === "center")?.nodeId ??
          `group:${selectedGroup.groupId}`;
        const upstreamRelations = new Map<string, "imports" | "calls" | "implements" | "uses">();
        const downstreamRelations = new Map<string, "imports" | "calls" | "implements" | "uses">();
        const upstreamNodeIds = new Set<string>();
        const downstreamNodeIds = new Set<string>();

        for (const edge of selectedGroup.architectureGraph.edges) {
          if (edge.toNodeId === centerNodeId) {
            upstreamRelations.set(edge.fromNodeId, edge.relation);
            upstreamNodeIds.add(edge.fromNodeId);
          }

          if (edge.fromNodeId === centerNodeId) {
            downstreamRelations.set(edge.toNodeId, edge.relation);
            downstreamNodeIds.add(edge.toNodeId);
          }
        }

        const upstreamNodes = [...upstreamNodeIds]
          .map((nodeId) => nodeById.get(nodeId))
          .filter(
            (node): node is NonNullable<typeof node> => !!node,
          )
          .sort((left, right) => left.label.localeCompare(right.label));
        const downstreamNodes = [...downstreamNodeIds]
          .map((nodeId) => nodeById.get(nodeId))
          .filter(
            (node): node is NonNullable<typeof node> => !!node,
          )
          .sort((left, right) => left.label.localeCompare(right.label));

        return [
          {
            label: "upstream" as const,
            nodes: upstreamNodes.map((node) => ({
              nodeId: node.nodeId,
              linkedGroupId: node.linkedGroupId,
            })),
            relationByNodeId: upstreamRelations,
          },
          {
            label: "downstream" as const,
            nodes: downstreamNodes.map((node) => ({
              nodeId: node.nodeId,
              linkedGroupId: node.linkedGroupId,
            })),
            relationByNodeId: downstreamRelations,
          },
        ];
      })()
    : [];

  return (
    <main className={styles.page}>
      <AnalysisStatusPoller
        active={true}
        reviewId={workspace.reviewId}
        currentToken={analysisStatusToken}
        analysisStatus={workspace.analysisStatus}
        reanalysisStatus={workspace.reanalysisStatus}
        analysisProcessedFiles={workspace.analysisProcessedFiles}
        analysisTotalFiles={workspace.analysisTotalFiles}
      />
      <div className={styles.header}>
        <div>
          <Link href="/" className={styles.muted}>
            {copy.links.backToHome}
          </Link>
          <h1 className={styles.workspaceTitle}>
            {formatWorkspaceTitle(workspace.title, workspaceLocale)}
          </h1>
          <div className={styles.meta}>
            <span>{copy.meta.reviewer}: {workspace.viewerName}</span>
            <span>{copy.meta.repository}: {workspace.repositoryName}</span>
            <span>{copy.meta.branch}: {workspace.branchLabel}</span>
            <span>
              {copy.meta.lastOpened}:{" "}
              <LocalizedDateTime isoTimestamp={workspace.lastOpenedAt} locale={workspaceLocale} />
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <div className={styles.localeSwitcher} aria-label={copy.actions.languageLabel}>
            <form action={setWorkspaceLocaleAction}>
              <input
                name="redirectPath"
                type="hidden"
                value={`/reviews/${workspace.reviewId}`}
              />
              <input name="locale" type="hidden" value="ja" />
              <button
                className={styles.localeButton}
                data-active={workspaceLocale === "ja"}
                type="submit"
                data-testid="workspace-locale-ja"
              >
                {copy.actions.switchToJapanese}
              </button>
            </form>
            <form action={setWorkspaceLocaleAction}>
              <input
                name="redirectPath"
                type="hidden"
                value={`/reviews/${workspace.reviewId}`}
              />
              <input name="locale" type="hidden" value="en" />
              <button
                className={styles.localeButton}
                data-active={workspaceLocale === "en"}
                type="submit"
                data-testid="workspace-locale-en"
              >
                {copy.actions.switchToEnglish}
              </button>
            </form>
          </div>
          <Link className={styles.actionButton} href="/settings/connections">
            {copy.links.connections}
          </Link>
          <form action={requestReanalysisAction}>
            <input name="reviewId" type="hidden" value={workspace.reviewId} />
            <ReanalyzeSubmitButton
              idleLabel={copy.actions.queueReanalysis}
              pendingLabel={copy.actions.queueingReanalysis}
            />
          </form>
        </div>
      </div>

      {workspaceErrorMessage ? (
        <section className={styles.workspaceAlert} role="status" aria-live="polite">
          <p>{workspaceErrorMessage}</p>
          <p className={styles.muted}>{copy.text.workspaceErrorNextAction}</p>
        </section>
      ) : null}

      <div className={styles.layout}>
        <section className={styles.panel}>
          <h2>{copy.section.changeGroups}</h2>
          {workspace.groups.length > 0 ? (
            <ul className={styles.groupList}>
              {workspace.groups.map((group) => (
                <li key={group.groupId}>
                  <form action={selectReviewGroupAction}>
                    <input name="reviewId" type="hidden" value={workspace.reviewId} />
                    <input name="groupId" type="hidden" value={group.groupId} />
                    <button
                      className={styles.groupButton}
                      data-selected={group.isSelected}
                      type="submit"
                      data-testid={`group-button-${group.groupId}`}
                    >
                      <span className={styles.groupTitle}>
                        <span className={styles.groupTitleText}>
                          {formatReviewGroupTitle(group.title, workspaceLocale)}
                        </span>
                        <span className={styles.badge} data-status={group.status}>
                          {formatReviewGroupStatus(group.status, workspaceLocale)}
                        </span>
                      </span>
                      <p className={styles.groupListSummary}>
                        {formatReviewGroupSummary(group.summary, workspaceLocale)}
                      </p>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : isInitialAnalysisRunning ? (
            <p className={styles.muted}>
              {copy.text.changeGroupsWillAppear}
            </p>
          ) : (
            <p className={styles.muted}>{copy.text.noChangeGroupsYet}</p>
          )}
        </section>

        <section className={styles.panel}>
          <h2>{copy.section.detailPane}</h2>
          {selectedGroup ? (
            <>
              <div className={styles.detailBlock}>
                <span className={styles.badge} data-status={selectedGroup.status}>
                  {formatReviewGroupStatus(selectedGroup.status, workspaceLocale)}
                </span>
                <h3 className={styles.selectedGroupTitle}>
                  {formatReviewGroupTitle(selectedGroup.title, workspaceLocale)}
                </h3>
                <p className={styles.groupSummary}>
                  {formatReviewGroupSummary(selectedGroup.summary, workspaceLocale)}
                </p>
                <p className={styles.filePath}>{selectedGroup.filePath}</p>
              </div>

              <form action={setReviewGroupStatusAction} className={styles.statusActions}>
                <input name="reviewId" type="hidden" value={workspace.reviewId} />
                <input name="groupId" type="hidden" value={selectedGroup.groupId} />
                {workspace.availableStatuses.map((status) => (
                  <button
                    key={status}
                    className={styles.statusButton}
                    data-active={selectedGroup.status === status}
                    name="status"
                    type="submit"
                    value={status}
                    data-testid={`status-button-${status}`}
                  >
                    {formatMarkStatusAction(status, workspaceLocale)}
                  </button>
                ))}
              </form>

              <div className={styles.detailBlock}>
                <span className={styles.muted}>
                  {copy.section.semanticChanges} ({selectedGroup.semanticChanges.length})
                </span>
                {selectedGroup.semanticChanges.length > 0 ? (
                  <ul className={styles.semanticChangeList}>
                    {selectedGroup.semanticChanges.map((change) => {
                      const focusView = toSemanticChangeFocusView({
                        locale: workspaceLocale,
                        changeType: change.changeType,
                        bodySummary: change.bodySummary,
                        before: change.before,
                        after: change.after,
                      });

                      return (
                        <li key={change.semanticChangeId} className={styles.semanticChangeCard}>
                          <div className={styles.semanticChangeHeader}>
                            <strong>{change.symbolDisplayName}</strong>
                            <span
                              className={styles.changeBadge}
                              data-change-type={change.changeType}
                            >
                              {formatSemanticChangeType(change.changeType, workspaceLocale)}
                            </span>
                          </div>
                          <ul className={styles.metaChipList}>
                            {compactTextItems([
                              `${copy.text.semanticKind}: ${formatSemanticSymbolKind(change.symbolKind, workspaceLocale)}`,
                              change.signatureSummary
                                ? `${copy.text.semanticSignature}: ${change.signatureSummary}`
                                : null,
                              change.bodySummary
                                ? `${copy.text.semanticBody}: ${
                                    formatSemanticBodySummary(change.bodySummary, workspaceLocale) ??
                                    change.bodySummary
                                  }`
                                : null,
                            ]).map((item) => (
                              <li key={`${change.semanticChangeId}-meta-${item}`} className={styles.metaChip}>
                                {item}
                              </li>
                            ))}
                          </ul>
                          <ul className={styles.metaChipList}>
                            {compactTextItems([
                              `${copy.text.semanticFocus}: ${focusView.focusLabel}`,
                              focusView.spanDeltaLabel
                                ? `${copy.text.semanticSpanDelta}: ${focusView.spanDeltaLabel}`
                                : null,
                            ]).map((item) => (
                              <li key={`${change.semanticChangeId}-focus-${item}`} className={styles.metaChip}>
                                {item}
                              </li>
                            ))}
                          </ul>
                          <CollapsibleDetails
                            className={styles.semanticLocationDetails}
                            summaryClassName={styles.semanticLocationSummary}
                            contentClassName={styles.semanticLocationContent}
                            summary={
                              <span className={styles.semanticChangeMeta}>
                                {copy.text.semanticLocationDetails}
                              </span>
                            }
                          >
                            <p className={styles.semanticChangeMeta}>
                              {copy.text.semanticBefore}: {formatCodeRegion(change.before)}
                            </p>
                            <p className={styles.semanticChangeMeta}>
                              {copy.text.semanticAfter}: {formatCodeRegion(change.after)}
                            </p>
                          </CollapsibleDetails>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className={styles.groupSummary}>
                    {copy.text.noSemanticChangeDetails}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className={styles.detailBlock}>
              <p className={styles.groupSummary}>
                {copy.text.changeGroupDetailsWillAppear}
              </p>
            </div>
          )}

          <CollapsibleDetails
            className={styles.collapsibleDetail}
            summaryClassName={styles.collapsibleSummary}
            contentClassName={styles.collapsibleContent}
            summary={
              <span className={styles.muted}>{copy.section.whyThisExists}</span>
            }
          >
            <p>
              {copy.text.whyThisExistsDescription}
            </p>
          </CollapsibleDetails>
          <div className={styles.detailBlock}>
            <span className={styles.muted}>{copy.section.initialAnalysis}</span>
            {workspace.analysisAttemptCount > 0 ? (
              <p className={styles.muted}>{copy.text.attempts}: {workspace.analysisAttemptCount}</p>
            ) : null}
            {workspace.analysisDurationMs !== null ? (
              <p className={styles.muted}>
                {copy.text.lastDuration}: {formatAnalysisDuration(workspace.analysisDurationMs)}
              </p>
            ) : null}
            {workspace.analysisStatus === "queued" ? (
              <p>{copy.text.analysisQueued}</p>
            ) : null}
            {workspace.analysisStatus === "fetching" ? (
              <p>{copy.text.analysisFetching}</p>
            ) : null}
            {workspace.analysisStatus === "parsing" ? (
              <>
                <p>
                  {copy.text.analysisParsing}
                  {workspace.analysisTotalFiles !== null ? (
                    <>
                      {" "}
                      ({Math.min(
                        workspace.analysisProcessedFiles ?? 0,
                        workspace.analysisTotalFiles,
                      )}
                      /{workspace.analysisTotalFiles} {copy.text.filesSuffix})
                    </>
                  ) : workspace.analysisProcessedFiles !== null ? (
                    <> ({workspace.analysisProcessedFiles} {copy.text.filesProcessedSuffix})</>
                  ) : null}
                  .
                </p>
                {workspace.analysisRequestedAt ? (
                  <p className={styles.muted}>
                    {copy.text.requestedAt}{" "}
                    <LocalizedDateTime
                      isoTimestamp={workspace.analysisRequestedAt}
                      locale={workspaceLocale}
                    />
                  </p>
                ) : null}
              </>
            ) : null}
            {workspace.activeAnalysisJob ? (
              <>
                <p className={styles.muted}>
                  {copy.text.trigger}: {formatAnalysisJobReason(workspace.activeAnalysisJob.reason, workspaceLocale)}
                </p>
                <p className={styles.muted}>
                  {copy.text.queueAcceptedAt}{" "}
                  <LocalizedDateTime
                    isoTimestamp={workspace.activeAnalysisJob.queuedAt}
                    locale={workspaceLocale}
                  />
                </p>
                {workspace.activeAnalysisJob.startedAt ? (
                  <p className={styles.muted}>
                    {copy.text.workerStartedAt}{" "}
                    <LocalizedDateTime
                      isoTimestamp={workspace.activeAnalysisJob.startedAt}
                      locale={workspaceLocale}
                    />
                  </p>
                ) : null}
              </>
            ) : null}
            {analysisProgressPercent !== null ? (
              <>
                <div
                  className={styles.analysisProgressTrack}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={analysisProgressPercent}
                  aria-label={copy.text.analysisProgressAriaLabel}
                >
                  <div
                    className={styles.analysisProgressFill}
                    style={{ width: `${analysisProgressPercent}%` }}
                  />
                </div>
                <p className={styles.muted}>
                  {copy.text.progress}: {analysisProgressPercent.toFixed(1)}%
                </p>
              </>
            ) : null}
            {workspace.analysisStatus === "ready" ? (
              workspace.analysisCompletedAt ? (
                <p>
                  {copy.text.readyAt}{" "}
                  <LocalizedDateTime
                    isoTimestamp={workspace.analysisCompletedAt}
                    locale={workspaceLocale}
                  />
                </p>
              ) : (
                <p>{copy.text.analysisReady}</p>
              )
            ) : null}
            {workspace.analysisStatus === "failed" ? (
              <>
                <p>{copy.text.initialAnalysisFailed}</p>
                {workspace.analysisError ? (
                  <p className={styles.reanalysisError}>{workspace.analysisError}</p>
                ) : null}
                <form action={requestInitialAnalysisRetryAction}>
                  <input name="reviewId" type="hidden" value={workspace.reviewId} />
                  <InitialAnalysisRetrySubmitButton
                    idleLabel={copy.actions.retryInitialAnalysis}
                    pendingLabel={copy.actions.retryingInitialAnalysis}
                  />
                </form>
              </>
            ) : null}
            {isInitialAnalysisRunning && workspace.groups.length === 0 ? (
              <p className={styles.muted}>{copy.text.firstRunMayTakeLonger}</p>
            ) : null}
            <div className={styles.analysisControls}>
              <AnalysisManualRefreshButton
                idleLabel={copy.actions.reloadNow}
                pendingLabel={copy.actions.refreshing}
              />
              <p className={styles.analysisHintText}>{copy.text.autoRefreshHint}</p>
            </div>
          </div>
          <CollapsibleDetails
            className={styles.collapsibleDetail}
            summaryClassName={styles.collapsibleSummary}
            contentClassName={styles.collapsibleContent}
            defaultOpen={workspace.reanalysisStatus !== "idle"}
            summary={
              <span className={styles.muted}>{copy.section.reanalysisStatus}</span>
            }
          >
            {workspace.reanalysisStatus === "idle" ? (
              <p>{copy.text.notRequestedYet}</p>
            ) : null}
            {workspace.reanalysisStatus === "queued" && workspace.lastReanalyzeRequestedAt ? (
              <p>
                {copy.text.queuedSince}{" "}
                <LocalizedDateTime
                  isoTimestamp={workspace.lastReanalyzeRequestedAt}
                  locale={workspaceLocale}
                />
              </p>
            ) : null}
            {workspace.reanalysisStatus === "queued" && !workspace.lastReanalyzeRequestedAt ? (
              <p>{copy.text.queuedOnly}</p>
            ) : null}
            {workspace.reanalysisStatus === "running" && workspace.lastReanalyzeRequestedAt ? (
              <p>
                {copy.text.runningSince}{" "}
                <LocalizedDateTime
                  isoTimestamp={workspace.lastReanalyzeRequestedAt}
                  locale={workspaceLocale}
                />
              </p>
            ) : null}
            {workspace.reanalysisStatus === "running" && !workspace.lastReanalyzeRequestedAt ? (
              <p>{copy.text.runningOnly}</p>
            ) : null}
            {workspace.reanalysisStatus === "succeeded" ? (
              <>
                {workspace.lastReanalyzeCompletedAt ? (
                  <p>
                    {copy.text.succeededAt}{" "}
                    <LocalizedDateTime
                      isoTimestamp={workspace.lastReanalyzeCompletedAt}
                      locale={workspaceLocale}
                    />
                  </p>
                ) : (
                  <p>{copy.text.succeededOnly}</p>
                )}
                {workspace.lastReanalyzeRequestedAt ? (
                  <p className={styles.muted}>
                    {copy.text.requestedAt}{" "}
                    <LocalizedDateTime
                      isoTimestamp={workspace.lastReanalyzeRequestedAt}
                      locale={workspaceLocale}
                    />
                  </p>
                ) : null}
              </>
            ) : null}
            {workspace.reanalysisStatus === "failed" ? (
              <>
                {workspace.lastReanalyzeCompletedAt ? (
                  <p>
                    {copy.text.failedAt}{" "}
                    <LocalizedDateTime
                      isoTimestamp={workspace.lastReanalyzeCompletedAt}
                      locale={workspaceLocale}
                    />
                  </p>
                ) : (
                  <p>{copy.text.failedOnly}</p>
                )}
                {workspace.lastReanalyzeError ? (
                  <p className={styles.reanalysisError}>{workspace.lastReanalyzeError}</p>
                ) : null}
              </>
            ) : null}
          </CollapsibleDetails>

          <CollapsibleDetails
            className={styles.collapsibleDetail}
            summaryClassName={styles.collapsibleSummary}
            contentClassName={styles.collapsibleContent}
            defaultOpen={false}
            summary={
              <span className={styles.muted}>
                {copy.section.aiSuggestions} ({workspace.aiSuggestions.length})
              </span>
            }
          >
            <AiSuggestionPanel
              reviewId={workspace.reviewId}
              locale={workspaceLocale}
              suggestions={workspace.aiSuggestions}
            />
          </CollapsibleDetails>

          <CollapsibleDetails
            className={styles.collapsibleDetail}
            summaryClassName={styles.collapsibleSummary}
            contentClassName={styles.collapsibleContent}
            defaultOpen={false}
            summary={
              <span className={styles.muted}>
                {copy.section.analysisJobs} ({workspace.analysisHistory.length})
              </span>
            }
          >
            <p className={styles.muted}>
              {copy.text.averageDuration}: {workspace.dogfoodingMetrics.averageDurationMs !== null
                ? formatAnalysisDuration(workspace.dogfoodingMetrics.averageDurationMs)
                : "—"}
              {" · "}
              {copy.text.failureRate}: {formatNullablePercent(workspace.dogfoodingMetrics.failureRatePercent)}
              {" · "}
              {copy.text.recoverySuccessRate}:{" "}
              {formatNullablePercent(workspace.dogfoodingMetrics.recoverySuccessRatePercent)}
            </p>
            {workspace.analysisHistory.length > 0 ? (
              <ul className={styles.analysisHistoryList}>
                {workspace.analysisHistory.map((job) => (
                  <li key={job.jobId} className={styles.analysisHistoryItem}>
                    <p className={styles.muted}>
                      {formatAnalysisJobReason(job.reason, workspaceLocale)} ·{" "}
                      {copy.text.jobStatus}: {formatAnalysisJobStatus(job.status, workspaceLocale)}
                    </p>
                    <p className={styles.muted}>
                      {copy.text.jobQueuedAt}:{" "}
                      <LocalizedDateTime isoTimestamp={job.queuedAt} locale={workspaceLocale} />
                      {" · "}
                      {copy.text.jobAttempts}: {job.attempts}
                      {" · "}
                      {copy.text.jobDuration}: {job.durationMs !== null ? formatAnalysisDuration(job.durationMs) : "—"}
                    </p>
                    {job.lastError ? (
                      <p className={styles.reanalysisError}>{job.lastError}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{copy.text.noAnalysisJobsYet}</p>
            )}
          </CollapsibleDetails>

          <CollapsibleDetails
            className={styles.collapsibleDetail}
            summaryClassName={styles.collapsibleSummary}
            contentClassName={styles.collapsibleContent}
            defaultOpen={false}
            summary={
              <span className={styles.muted}>
                {copy.section.analysisCoverage} ({workspace.unsupportedSummary.totalCount})
              </span>
            }
          >
            {workspace.analysisTotalFiles !== null &&
            workspace.analysisSupportedFiles !== null &&
            workspace.analysisCoveragePercent !== null ? (
              <p className={styles.muted}>
                {copy.text.coverage}: {workspace.analysisSupportedFiles}/{workspace.analysisTotalFiles} (
                {formatCoveragePercent(workspace.analysisCoveragePercent)})
              </p>
            ) : null}
            {workspace.unsupportedSummary.totalCount === 0 ? (
              <p>{copy.text.allFilesCovered}</p>
            ) : (
              <>
                <p>
                  {workspace.unsupportedSummary.totalCount} {copy.text.excludedFiles}
                </p>
                <ul className={styles.unsupportedList}>
                  {workspace.unsupportedSummary.byReason.map((entry) => (
                    <li key={entry.reason}>
                      {formatUnsupportedReason(entry.reason, workspaceLocale)}: {entry.count}
                    </li>
                  ))}
                </ul>
                {workspace.unsupportedFiles.length > 0 ? (
                  <ul className={styles.unsupportedFileList}>
                    {workspace.unsupportedFiles.map((entry) => (
                      <li key={`${entry.reason}:${entry.filePath}`} className={styles.unsupportedFileItem}>
                        <div className={styles.unsupportedFileHeader}>
                          <span className={styles.unsupportedFilePath}>{entry.filePath}</span>
                          <span className={styles.unsupportedFileReason}>
                            {formatUnsupportedReason(entry.reason, workspaceLocale)}
                          </span>
                        </div>
                        <p className={styles.muted}>
                          {copy.text.language}: {entry.language ?? copy.text.unknownLanguage}
                          {entry.detail ? ` · ${copy.text.detail}: ${entry.detail}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {hiddenUnsupportedFileCount > 0 ? (
                  <p className={styles.muted}>
                    {copy.text.showingFirstEntriesPrefix} {workspace.unsupportedFiles.length}{" "}
                    {copy.text.showingFirstEntriesSuffix} {hiddenUnsupportedFileCount}{" "}
                    {copy.text.hiddenEntriesSuffix}
                  </p>
                ) : null}
              </>
            )}
          </CollapsibleDetails>

          <CollapsibleDetails
            className={styles.collapsibleDetail}
            summaryClassName={styles.collapsibleSummary}
            contentClassName={styles.collapsibleContent}
            defaultOpen={workspace.businessContext.diagnostics.status === "fallback"}
            summary={
              <span className={styles.muted}>
                {copy.section.businessContext} ({workspace.businessContext.items.length})
              </span>
            }
          >
            <p className={styles.muted}>{copy.text.businessContextHint}</p>
            {workspace.businessContext.diagnostics.status === "fallback" ? (
              <div className={styles.workspaceAlert}>
                <p>{copy.text.businessContextFallback}</p>
                {workspace.businessContext.diagnostics.message ? (
                  <p className={styles.reanalysisError}>{workspace.businessContext.diagnostics.message}</p>
                ) : null}
                <p className={styles.muted}>{copy.text.businessContextFallbackRetryHint}</p>
                {workspace.businessContext.diagnostics.occurredAt ? (
                  <p className={styles.muted}>
                    <LocalizedDateTime
                      isoTimestamp={workspace.businessContext.diagnostics.occurredAt}
                      locale={workspaceLocale}
                    />
                  </p>
                ) : null}
              </div>
            ) : null}
            {workspace.businessContext.items.length > 0 ? (
              <ul className={styles.businessContextList}>
                {workspace.businessContext.items.map((contextItem) => (
                  <li key={contextItem.contextId} className={styles.businessContextItem}>
                    <div className={styles.businessContextHeader}>
                      {contextItem.href ? (
                        <a
                          href={contextItem.href}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.actionButton}
                          style={{
                            minHeight: "auto",
                            padding: "6px 10px",
                            width: "100%",
                            textAlign: "left",
                            textDecoration: "none",
                            borderRadius: "10px",
                          }}
                        >
                          {formatBusinessContextTitle(contextItem.title, workspaceLocale)}
                        </a>
                      ) : (
                        <span className={styles.groupSummary}>
                          {formatBusinessContextTitle(contextItem.title, workspaceLocale)}
                        </span>
                      )}
                    </div>
                    <ul className={styles.metaChipList}>
                      {compactTextItems([
                        `${copy.text.businessContextSource}: ${formatBusinessContextSourceType(
                          contextItem.sourceType,
                          workspaceLocale,
                        )}`,
                        `${copy.text.businessContextStatus}: ${formatBusinessContextStatus(
                          contextItem.status,
                          workspaceLocale,
                        )}`,
                        `${copy.text.businessContextConfidence}: ${formatBusinessContextConfidence(
                          contextItem.confidence,
                          workspaceLocale,
                        )}`,
                        `${copy.text.businessContextInferenceSource}: ${formatBusinessContextInferenceSource(
                          contextItem.inferenceSource,
                          workspaceLocale,
                        )}`,
                      ]).map((item) => (
                        <li
                          key={`${contextItem.contextId}-meta-${item}`}
                          className={styles.metaChip}
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                    {contextItem.summary ? (
                      <p className={styles.muted}>
                        {formatBusinessContextSummary(contextItem.summary, workspaceLocale)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{copy.text.noBusinessContextItems}</p>
            )}
          </CollapsibleDetails>
        </section>

        <aside className={styles.panel}>
          <h2>{copy.section.architecturePane}</h2>
          <p className={styles.muted} style={{ marginBottom: "14px" }}>
            {copy.text.architectureScopeHint}
          </p>
          {selectedGroup ? (
            <div className={styles.archColumns}>
              {architectureColumns.map((column) => {
                const groupedNodes = groupArchitectureNodes(
                  column.nodes.map((node) => node.nodeId),
                );
                const nodeById = new Map(column.nodes.map((node) => [node.nodeId, node] as const));
                const categories = ARCHITECTURE_CATEGORY_ORDER
                  .map((category) => [
                    category,
                    groupedNodes[category],
                  ] as const)
                  .filter(([, nodes]) => nodes.length > 0);

                return (
                  <div key={column.label} className={styles.archColumn}>
                    <h3 className={styles.archColumnHeading}>
                      {formatArchitectureColumnLabel(column.label, workspaceLocale)}
                    </h3>
                    {categories.length === 0 ? (
                      <p className={styles.muted}>{copy.text.noRelatedNodes}</p>
                    ) : (
                      <div className={styles.archSections}>
                        {categories.map(([category, nodes]) => (
                          <section
                            key={`${column.label}-${category}`}
                            aria-labelledby={`arch-${column.label}-${category}`}
                            className={styles.archSection}
                          >
                            <h4
                              id={`arch-${column.label}-${category}`}
                              className={styles.archSectionHeading}
                            >
                              {formatArchitectureCategoryLabel(category, workspaceLocale)}
                            </h4>
                            <ul className={styles.archNodeList}>
                              {nodes.map((node) => (
                                <li key={`${column.label}-${node.raw}`}>
                                  {(() => {
                                    const nodeRecord = nodeById.get(node.raw);
                                    const relation = column.relationByNodeId.get(node.raw);
                                    const linkedGroupId = nodeRecord?.linkedGroupId ?? null;
                                    const shouldLink =
                                      linkedGroupId !== null &&
                                      linkedGroupId !== selectedGroup.groupId;

                                    if (!shouldLink) {
                                      return (
                                        <div className={styles.archNodeCard}>
                                          <span className={styles.archNodeLabel}>{node.label}</span>
                                          {relation ? (
                                            <span className={styles.archNodeMeta}>
                                              {formatArchitectureRelation(relation, workspaceLocale)}
                                            </span>
                                          ) : null}
                                        </div>
                                      );
                                    }

                                    return (
                                      <form action={selectReviewGroupAction}>
                                        <input
                                          name="reviewId"
                                          type="hidden"
                                          value={workspace.reviewId}
                                        />
                                        <input
                                          name="groupId"
                                          type="hidden"
                                          value={linkedGroupId}
                                        />
                                        <button className={styles.archNodeButton} type="submit">
                                          <span className={styles.srOnly}>
                                            {copy.text.switchToRelatedGroup}
                                          </span>
                                          <span className={styles.archNodeLabel}>{node.label}</span>
                                          {relation ? (
                                            <span className={styles.archNodeMeta}>
                                              {formatArchitectureRelation(relation, workspaceLocale)}
                                            </span>
                                          ) : null}
                                        </button>
                                      </form>
                                    );
                                  })()}
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={styles.muted}>{copy.text.architectureContextWillAppear}</p>
          )}
        </aside>
      </div>
    </main>
  );
}
