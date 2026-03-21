import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LocalizedDateTime } from "@/app/components/localized-date-time";
import { OAuthFeedbackCleanup } from "@/app/(workspace)/settings/connections/oauth-feedback-cleanup";
import { resolveWorkspaceLocale } from "@/app/(workspace)/workspace-locale";
import type { ConnectionProviderKey } from "@/server/application/services/connection-catalog";
import { loadConnectionsWorkspaceDto } from "@/server/presentation/api/load-connections-workspace";
import { listConnectionStateTransitions } from "@/server/presentation/api/list-connection-state-transitions";
import { DEMO_VIEWER_COOKIE_NAME } from "@/server/presentation/actions/demo-viewer-cookie-name";
import { resolveAuthenticatedReviewerId } from "@/server/presentation/actions/reviewer-identity";
import { setConnectionStateAction } from "@/server/presentation/actions/set-connection-state-action";
import { setWorkspaceLocaleAction } from "@/server/presentation/actions/set-workspace-locale-action";
import {
  connectionsCopyByLocale,
  formatAuthMode,
  formatCapabilityFlag,
  formatConnectedAccountLabel,
  formatProvider,
  formatStateSource,
  formatStatus,
  formatTransitionActor,
  formatTransitionOption,
  formatTransitionReason,
  resolveOAuthFeedback,
  type TransitionHistoryReason,
} from "./connections-copy";

const pageShellStyle = {
  maxWidth: "960px",
  margin: "0 auto",
  padding: "48px 24px 72px",
  display: "grid",
  gap: "20px",
} as const;

const summarySectionStyle = {
  border: "1px solid #2a3563",
  borderRadius: "24px",
  background: "rgba(18, 25, 51, 0.88)",
  padding: "28px",
} as const;

const cardsLayoutStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "16px",
} as const;

const cardStyle = {
  border: "1px solid rgba(154, 167, 209, 0.16)",
  borderRadius: "18px",
  background: "rgba(18, 25, 51, 0.78)",
  padding: "16px",
  display: "grid",
  gap: "6px",
  minWidth: 0,
  overflow: "hidden",
} as const;

const detailCardStyle = {
  border: "1px solid rgba(154, 167, 209, 0.16)",
  borderRadius: "10px",
  background: "rgba(11, 16, 32, 0.35)",
  padding: "8px 10px",
  marginTop: "2px",
} as const;

const detailSummaryStyle = {
  cursor: "pointer",
  color: "#9aa7d1",
  fontSize: "13px",
  listStyle: "none",
} as const;

const detailParagraphStyle = {
  color: "#9aa7d1",
  marginTop: "8px",
  marginBottom: "0px",
  overflowWrap: "anywhere",
} as const;

interface ConnectionsPageSearchParams {
  historyReason?: string | string[];
  historyPage?: string | string[];
  historyPageSize?: string | string[];
  oauthSuccess?: string | string[];
  oauthError?: string | string[];
}

const TRANSITION_HISTORY_REASON_OPTIONS = [
  "all",
  "manual",
  "token-expired",
  "webhook",
] as const;

const TRANSITION_HISTORY_PAGE_SIZE_OPTIONS = [5, 10, 20] as const;

function resolveSearchParamValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return null;
}

function parseHistoryReason(
  value: string | null,
): TransitionHistoryReason | "all" {
  if (!value) {
    return "all";
  }

  return (TRANSITION_HISTORY_REASON_OPTIONS as readonly string[]).includes(value)
    ? (value as TransitionHistoryReason | "all")
    : "all";
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value || !/^\d+$/.test(value)) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function buildHistoryPageHref(input: {
  reason: TransitionHistoryReason | "all";
  page: number;
  pageSize: number;
}): string {
  const query = new URLSearchParams();

  if (input.reason !== "all") {
    query.set("historyReason", input.reason);
  }

  query.set("historyPage", String(input.page));
  query.set("historyPageSize", String(input.pageSize));

  const encoded = query.toString();
  return encoded.length > 0 ? `/settings/connections?${encoded}` : "/settings/connections";
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<ConnectionsPageSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const headerStore = await headers();
  const cookieStore = await cookies();
  const workspaceLocale = resolveWorkspaceLocale({
    preferredLocale: cookieStore.get("locus-ui-locale")?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });
  const copy = connectionsCopyByLocale[workspaceLocale];
  const viewerCookie = cookieStore.get(DEMO_VIEWER_COOKIE_NAME)?.value;
  const { reviewerId } = await resolveAuthenticatedReviewerId(viewerCookie);
  const viewerName = viewerCookie ?? copy.signedOut;
  const historyReason = parseHistoryReason(
    resolveSearchParamValue(resolvedSearchParams.historyReason),
  );
  const historyPage = parsePositiveInt(
    resolveSearchParamValue(resolvedSearchParams.historyPage),
    1,
    30,
  );
  const historyPageSize = parsePositiveInt(
    resolveSearchParamValue(resolvedSearchParams.historyPageSize),
    5,
    20,
  );
  const oauthFeedback = resolveOAuthFeedback({
    successCode: resolveSearchParamValue(resolvedSearchParams.oauthSuccess),
    errorCode: resolveSearchParamValue(resolvedSearchParams.oauthError),
    locale: workspaceLocale,
  });
  const connectionsWorkspace = await loadConnectionsWorkspaceDto({
    reviewerId,
    transitionReason: historyReason,
    transitionPage: historyPage,
    transitionPageSize: historyPageSize,
  });

  return (
    <main style={pageShellStyle}>
      {oauthFeedback ? <OAuthFeedbackCleanup /> : null}
      <Link href="/" style={{ color: "#9aa7d1" }}>
        {copy.backToHome}
      </Link>
      <section
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
        aria-label={copy.languageLabel}
      >
        <span style={{ color: "#9aa7d1", fontSize: "13px" }}>{copy.languageLabel}</span>
        <form action={setWorkspaceLocaleAction}>
          <input name="redirectPath" type="hidden" value="/settings/connections" />
          <input name="locale" type="hidden" value="ja" />
          <button
            type="submit"
            style={{
              borderRadius: "10px",
              border:
                workspaceLocale === "ja"
                  ? "1px solid rgba(124, 156, 255, 0.65)"
                  : "1px solid rgba(154, 167, 209, 0.24)",
              background:
                workspaceLocale === "ja"
                  ? "rgba(94, 123, 255, 0.16)"
                  : "rgba(18, 25, 51, 0.88)",
              color: "white",
              minHeight: "34px",
              padding: "0 12px",
            }}
          >
            {copy.switchToJapanese}
          </button>
        </form>
        <form action={setWorkspaceLocaleAction}>
          <input name="redirectPath" type="hidden" value="/settings/connections" />
          <input name="locale" type="hidden" value="en" />
          <button
            type="submit"
            style={{
              borderRadius: "10px",
              border:
                workspaceLocale === "en"
                  ? "1px solid rgba(124, 156, 255, 0.65)"
                  : "1px solid rgba(154, 167, 209, 0.24)",
              background:
                workspaceLocale === "en"
                  ? "rgba(94, 123, 255, 0.16)"
                  : "rgba(18, 25, 51, 0.88)",
              color: "white",
              minHeight: "34px",
              padding: "0 12px",
            }}
          >
            {copy.switchToEnglish}
          </button>
        </form>
      </section>
      <section style={summarySectionStyle}>
        <p style={{ color: "#9aa7d1", marginBottom: "12px" }}>{copy.authStub}</p>
        <h1 style={{ fontSize: "36px", marginBottom: "12px" }}>{copy.title}</h1>
        <p style={{ color: "#9aa7d1", marginBottom: "18px", overflowWrap: "anywhere" }}>
          {copy.description}
        </p>
        <p style={{ marginBottom: "8px", overflowWrap: "anywhere" }}>
          {copy.reviewerIdentity}: <strong>{viewerName}</strong>
        </p>
        <p style={{ color: "#9aa7d1", marginBottom: "0px" }}>
          {copy.generatedAt}:{" "}
          <LocalizedDateTime
            isoTimestamp={connectionsWorkspace.generatedAt}
            locale={workspaceLocale}
          />
        </p>
        {oauthFeedback ? (
          <p
            style={{
              marginTop: "12px",
              marginBottom: "0px",
              border: oauthFeedback.kind === "success"
                ? "1px solid rgba(106, 201, 128, 0.45)"
                : "1px solid rgba(217, 114, 114, 0.45)",
              borderRadius: "10px",
              background: oauthFeedback.kind === "success"
                ? "rgba(53, 122, 74, 0.2)"
                : "rgba(130, 51, 51, 0.2)",
              color: oauthFeedback.kind === "success" ? "#c6f5d3" : "#ffd7d7",
              padding: "8px 10px",
              overflowWrap: "anywhere",
            }}
          >
            {oauthFeedback.message}
          </p>
        ) : null}
        <form
          method="get"
          action="/settings/connections"
          style={{
            marginTop: "14px",
            display: "grid",
            gap: "8px",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            alignItems: "end",
          }}
        >
          <label style={{ color: "#9aa7d1", fontSize: "13px" }}>
            {copy.historyReasonFilterLabel}
            <select
              name="historyReason"
              defaultValue={historyReason}
              style={{
                display: "block",
                marginTop: "4px",
                background: "rgba(14, 21, 43, 0.96)",
                color: "white",
                border: "1px solid rgba(154, 167, 209, 0.24)",
                borderRadius: "10px",
                padding: "8px 10px",
              }}
            >
              <option value="all">{copy.historyReasonFilterAll}</option>
              <option value="manual">
                {formatTransitionReason("manual", workspaceLocale)}
              </option>
              <option value="token-expired">
                {formatTransitionReason("token-expired", workspaceLocale)}
              </option>
              <option value="webhook">
                {formatTransitionReason("webhook", workspaceLocale)}
              </option>
            </select>
          </label>
          <label style={{ color: "#9aa7d1", fontSize: "13px" }}>
            {copy.historyPageSizeLabel}
            <select
              name="historyPageSize"
              defaultValue={String(historyPageSize)}
              style={{
                display: "block",
                marginTop: "4px",
                background: "rgba(14, 21, 43, 0.96)",
                color: "white",
                border: "1px solid rgba(154, 167, 209, 0.24)",
                borderRadius: "10px",
                padding: "8px 10px",
              }}
            >
              {TRANSITION_HISTORY_PAGE_SIZE_OPTIONS.map((pageSizeOption) => (
                <option key={pageSizeOption} value={String(pageSizeOption)}>
                  {pageSizeOption}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="historyPage" value="1" />
          <button
            type="submit"
            style={{
              border: "1px solid rgba(124, 156, 255, 0.65)",
              borderRadius: "10px",
              background: "rgba(94, 123, 255, 0.16)",
              color: "white",
              minHeight: "34px",
              cursor: "pointer",
              padding: "0 12px",
              width: "100%",
            }}
          >
            {copy.historyApplyButton}
          </button>
        </form>
      </section>
      <section style={cardsLayoutStyle}>
        {connectionsWorkspace.connections.map((connection) => {
          const availableTransitions = listConnectionStateTransitions(connection.status);
          const canUseGitHubOAuth =
            connection.provider === "github" && connection.authMode === "oauth";
          const oauthStartHref =
            `/api/integrations/github/oauth/start?redirectPath=${encodeURIComponent("/settings/connections")}`;
          const oauthButtonLabel =
            connection.status === "connected"
              ? copy.oauthReconnectButton
              : copy.oauthConnectButton;

          return (
            <article key={connection.provider} style={cardStyle}>
              <h2 style={{ marginBottom: "0px", overflowWrap: "anywhere" }}>
                {formatProvider(connection.provider, workspaceLocale)}
              </h2>
              <p
                data-testid={`connection-status-${connection.provider}`}
                style={{ color: "#9aa7d1", overflowWrap: "anywhere" }}
              >
                {copy.statusLabel}: {formatStatus(connection.status, workspaceLocale)}
              </p>
              <p style={{ color: "#9aa7d1" }}>
                {copy.authModeLabel}: {formatAuthMode(connection.authMode, workspaceLocale)}
              </p>
              <p style={{ color: "#9aa7d1" }}>
                {copy.stateSourceLabel}:{" "}
                {formatStateSource(connection.stateSource, workspaceLocale)}
              </p>
              <p style={{ color: "#9aa7d1" }}>
                {copy.updatedAtLabel}:{" "}
                {connection.statusUpdatedAt ? (
                  <LocalizedDateTime
                    isoTimestamp={connection.statusUpdatedAt}
                    locale={workspaceLocale}
                  />
                ) : (
                  formatConnectedAccountLabel(null, workspaceLocale)
                )}
              </p>
              <p style={{ color: "#9aa7d1", overflowWrap: "anywhere" }}>
                {copy.accountLabel}:{" "}
                {formatConnectedAccountLabel(
                  connection.connectedAccountLabel,
                  workspaceLocale,
                )}
              </p>
              <p style={{ color: "#9aa7d1", overflowWrap: "anywhere" }}>
                {copy.capabilitiesLabel}: {copy.supportsWebhook} (
                {formatCapabilityFlag(connection.capabilities.supportsWebhook, workspaceLocale)}),{" "}
                {copy.supportsIssueContext} (
                {formatCapabilityFlag(
                  connection.capabilities.supportsIssueContext,
                  workspaceLocale,
                )}
                )
              </p>
              {canUseGitHubOAuth ? (
                <a
                  href={oauthStartHref}
                  style={{
                    border: "1px solid rgba(124, 156, 255, 0.65)",
                    borderRadius: "10px",
                    background: "rgba(94, 123, 255, 0.16)",
                    color: "white",
                    minHeight: "34px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 12px",
                    textDecoration: "none",
                    width: "fit-content",
                    maxWidth: "100%",
                    overflowWrap: "anywhere",
                  }}
                >
                  {oauthButtonLabel}
                </a>
              ) : null}

              <details style={detailCardStyle}>
                <summary style={detailSummaryStyle}>{copy.providerNotesLabel}</summary>
                <p style={detailParagraphStyle}>
                  {copy.providerDescriptionByKey[
                    connection.provider as ConnectionProviderKey
                  ] ?? formatProvider(connection.provider, workspaceLocale)}
                </p>
              </details>

              <details style={detailCardStyle}>
                <summary style={detailSummaryStyle}>
                  {copy.transitionHistoryLabel} (
                  {connection.recentTransitions.length}/{connection.recentTransitionsTotalCount})
                </summary>
                {connection.recentTransitions.length > 0 ? (
                  <ul
                    style={{
                      listStyle: "none",
                      display: "grid",
                      gap: "6px",
                      marginTop: "8px",
                      maxHeight: "220px",
                      overflowY: "auto",
                      paddingRight: "4px",
                    }}
                  >
                    {connection.recentTransitions.map((transition) => (
                      <li
                        key={transition.transitionId}
                        style={{
                          border: "1px solid rgba(154, 167, 209, 0.16)",
                          borderRadius: "8px",
                          padding: "6px 8px",
                          background: "rgba(18, 25, 51, 0.65)",
                        }}
                      >
                        <p style={{ color: "#d6ddff", marginBottom: "4px", overflowWrap: "anywhere" }}>
                          {formatStatus(transition.previousStatus, workspaceLocale)} →{" "}
                          {formatStatus(transition.nextStatus, workspaceLocale)}
                        </p>
                        <p style={{ color: "#9aa7d1", marginBottom: "2px", fontSize: "12px" }}>
                          {copy.changedAtLabel}:{" "}
                          <LocalizedDateTime
                            isoTimestamp={transition.changedAt}
                            locale={workspaceLocale}
                          />
                        </p>
                        <p style={{ color: "#9aa7d1", marginBottom: "2px", fontSize: "12px" }}>
                          {copy.reasonLabel}:{" "}
                          {formatTransitionReason(transition.reason, workspaceLocale)}
                        </p>
                        <p style={{ color: "#9aa7d1", marginBottom: "2px", fontSize: "12px" }}>
                          {copy.actorLabel}:{" "}
                          {formatTransitionActor({
                            actorType: transition.actorType,
                            actorId: transition.actorId,
                            locale: workspaceLocale,
                          })}
                        </p>
                        {transition.connectedAccountLabel ? (
                          <p
                            style={{
                              color: "#9aa7d1",
                              marginBottom: "0px",
                              fontSize: "12px",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {copy.accountLabel}: {transition.connectedAccountLabel}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={detailParagraphStyle}>{copy.noTransitionHistory}</p>
                )}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: "8px",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ color: "#9aa7d1", fontSize: "12px" }}>
                    {copy.historyPageLabel}: {historyPage}
                  </span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {historyPage > 1 ? (
                      <Link
                        href={buildHistoryPageHref({
                          reason: historyReason,
                          page: historyPage - 1,
                          pageSize: historyPageSize,
                        })}
                        style={{ color: "#9aa7d1", fontSize: "12px" }}
                      >
                        {copy.previousPage}
                      </Link>
                    ) : (
                      <span style={{ color: "#6071a9", fontSize: "12px" }}>
                        {copy.previousPage}
                      </span>
                    )}
                    {connection.recentTransitionsHasMore ? (
                      <Link
                        href={buildHistoryPageHref({
                          reason: historyReason,
                          page: historyPage + 1,
                          pageSize: historyPageSize,
                        })}
                        style={{ color: "#9aa7d1", fontSize: "12px" }}
                      >
                        {copy.nextPage}
                      </Link>
                    ) : (
                      <span style={{ color: "#6071a9", fontSize: "12px" }}>
                        {copy.nextPage}
                      </span>
                    )}
                  </div>
                </div>
              </details>

              {availableTransitions.length > 0 ? (
                canUseGitHubOAuth ? (
                  <details style={detailCardStyle}>
                    <summary style={detailSummaryStyle}>{copy.manualOverrideSummary}</summary>
                    <p style={detailParagraphStyle}>{copy.manualOverrideDescription}</p>
                    <form
                      action={setConnectionStateAction}
                      style={{ display: "grid", gap: "8px", marginTop: "8px" }}
                    >
                      <input type="hidden" name="provider" value={connection.provider} />
                      <input type="hidden" name="redirectPath" value="/settings/connections" />
                      <label style={{ color: "#9aa7d1", fontSize: "13px" }}>
                        {copy.transitionLabel}
                        <select
                          name="nextStatus"
                          defaultValue={availableTransitions[0]}
                          data-testid={`connection-transition-select-${connection.provider}`}
                          style={{
                            display: "block",
                            width: "100%",
                            marginTop: "4px",
                            background: "rgba(14, 21, 43, 0.96)",
                            color: "white",
                            border: "1px solid rgba(154, 167, 209, 0.24)",
                            borderRadius: "10px",
                            padding: "8px 10px",
                          }}
                        >
                          {availableTransitions.map((status) => (
                            <option key={status} value={status}>
                              {formatTransitionOption(status, workspaceLocale)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ color: "#9aa7d1", fontSize: "13px" }}>
                        {copy.connectedAccountInputLabel}
                        <input
                          name="connectedAccountLabel"
                          defaultValue={connection.connectedAccountLabel ?? ""}
                          placeholder={copy.connectedAccountPlaceholder}
                          style={{
                            display: "block",
                            width: "100%",
                            marginTop: "4px",
                            background: "rgba(14, 21, 43, 0.96)",
                            color: "white",
                            border: "1px solid rgba(154, 167, 209, 0.24)",
                            borderRadius: "10px",
                            padding: "8px 10px",
                          }}
                        />
                      </label>
                      <button
                        type="submit"
                        data-testid={`connection-transition-submit-${connection.provider}`}
                        style={{
                          border: "1px solid rgba(124, 156, 255, 0.65)",
                          borderRadius: "10px",
                          background: "rgba(94, 123, 255, 0.16)",
                          color: "white",
                          minHeight: "34px",
                          cursor: "pointer",
                        }}
                      >
                        {copy.transitionButton}
                      </button>
                    </form>
                  </details>
                ) : (
                  <form
                    action={setConnectionStateAction}
                    style={{ display: "grid", gap: "8px", marginTop: "4px" }}
                  >
                    <input type="hidden" name="provider" value={connection.provider} />
                    <input type="hidden" name="redirectPath" value="/settings/connections" />
                    <label style={{ color: "#9aa7d1", fontSize: "13px" }}>
                      {copy.transitionLabel}
                      <select
                        name="nextStatus"
                        defaultValue={availableTransitions[0]}
                        data-testid={`connection-transition-select-${connection.provider}`}
                        style={{
                          display: "block",
                          width: "100%",
                          marginTop: "4px",
                          background: "rgba(14, 21, 43, 0.96)",
                          color: "white",
                          border: "1px solid rgba(154, 167, 209, 0.24)",
                          borderRadius: "10px",
                          padding: "8px 10px",
                        }}
                      >
                        {availableTransitions.map((status) => (
                          <option key={status} value={status}>
                            {formatTransitionOption(status, workspaceLocale)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ color: "#9aa7d1", fontSize: "13px" }}>
                      {copy.connectedAccountInputLabel}
                      <input
                        name="connectedAccountLabel"
                        defaultValue={connection.connectedAccountLabel ?? ""}
                        placeholder={copy.connectedAccountPlaceholder}
                        style={{
                          display: "block",
                          width: "100%",
                          marginTop: "4px",
                          background: "rgba(14, 21, 43, 0.96)",
                          color: "white",
                          border: "1px solid rgba(154, 167, 209, 0.24)",
                          borderRadius: "10px",
                          padding: "8px 10px",
                        }}
                      />
                    </label>
                    <button
                      type="submit"
                      data-testid={`connection-transition-submit-${connection.provider}`}
                      style={{
                        border: "1px solid rgba(124, 156, 255, 0.65)",
                        borderRadius: "10px",
                        background: "rgba(94, 123, 255, 0.16)",
                        color: "white",
                        minHeight: "34px",
                        cursor: "pointer",
                      }}
                    >
                      {copy.transitionButton}
                    </button>
                  </form>
                )
              ) : (
                <p style={{ color: "#9aa7d1", marginBottom: "0px" }}>
                  {copy.transitionUnavailable}
                </p>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
