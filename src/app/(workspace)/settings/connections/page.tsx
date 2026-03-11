import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LocalizedDateTime } from "@/app/components/localized-date-time";
import { resolveWorkspaceLocale } from "@/app/(workspace)/workspace-locale";
import type { ConnectionProviderKey } from "@/server/application/services/connection-catalog";
import { loadConnectionsWorkspaceDto } from "@/server/presentation/api/load-connections-workspace";
import { listConnectionStateTransitions } from "@/server/presentation/api/list-connection-state-transitions";
import { DEMO_VIEWER_COOKIE_NAME } from "@/server/presentation/actions/demo-viewer-cookie-name";
import { setConnectionStateAction } from "@/server/presentation/actions/set-connection-state-action";
import { setWorkspaceLocaleAction } from "@/server/presentation/actions/set-workspace-locale-action";

const copyByLocale = {
  en: {
    backToHome: "← Back to home",
    title: "Connections",
    authStub: "Connection model stub",
    description:
      "This page validates the connection-state contract before implementing actual OAuth flows.",
    reviewerIdentity: "Current reviewer identity",
    signedOut: "Signed out",
    languageLabel: "Language",
    switchToJapanese: "日本語",
    switchToEnglish: "English",
    generatedAt: "Catalog generated at",
    statusLabel: "Status",
    authModeLabel: "Auth mode",
    updatedAtLabel: "Updated at",
    accountLabel: "Connected account",
    stateSourceLabel: "State source",
    capabilitiesLabel: "Capabilities",
    supportsWebhook: "Webhook",
    supportsIssueContext: "Issue context",
    transitionLabel: "Change state",
    transitionButton: "Apply",
    transitionUnavailable:
      "State transition is not available for this provider in current status.",
    connectedAccountInputLabel: "Account label (optional)",
    connectedAccountPlaceholder: "e.g. duck8823",
    providerNotesLabel: "Provider notes",
    transitionHistoryLabel: "Recent transitions",
    noTransitionHistory: "No transitions recorded yet.",
    changedAtLabel: "Changed at",
    statusByKey: {
      not_connected: "Not connected",
      planned: "Planned",
      connected: "Connected",
      reauth_required: "Re-auth required",
    },
    stateSourceByKey: {
      catalog_default: "Catalog default",
      persisted: "Persisted state",
    },
    providerByKey: {
      github: "GitHub",
      confluence: "Confluence",
      jira: "Jira",
    },
    providerDescriptionByKey: {
      github:
        "OAuth endpoints are next; this card now tracks provider identity and lifecycle state.",
      confluence:
        "Context overlay integration is planned after the first hosted review loop stabilizes.",
      jira:
        "Issue-linking support is modeled in the contract but intentionally deferred from MVP v0.",
    },
  },
  ja: {
    backToHome: "← ホームへ戻る",
    title: "接続設定",
    authStub: "接続モデルスタブ",
    description:
      "OAuth 実装前に、接続状態の契約（状態モデル）を先に検証するページです。",
    reviewerIdentity: "現在のレビュアーID",
    signedOut: "未ログイン",
    languageLabel: "表示言語",
    switchToJapanese: "日本語",
    switchToEnglish: "English",
    generatedAt: "カタログ生成時刻",
    statusLabel: "状態",
    authModeLabel: "認証方式",
    updatedAtLabel: "更新時刻",
    accountLabel: "接続アカウント",
    stateSourceLabel: "状態ソース",
    capabilitiesLabel: "機能",
    supportsWebhook: "Webhook",
    supportsIssueContext: "Issueコンテキスト",
    transitionLabel: "状態変更",
    transitionButton: "適用",
    transitionUnavailable: "現在の状態では、この provider の状態変更はできません。",
    connectedAccountInputLabel: "接続アカウント名（任意）",
    connectedAccountPlaceholder: "例: duck8823",
    providerNotesLabel: "providerメモ",
    transitionHistoryLabel: "最近の状態変更",
    noTransitionHistory: "状態変更履歴はまだありません。",
    changedAtLabel: "変更時刻",
    statusByKey: {
      not_connected: "未接続",
      planned: "計画中",
      connected: "接続済み",
      reauth_required: "再認証が必要",
    },
    stateSourceByKey: {
      catalog_default: "カタログ既定値",
      persisted: "永続化状態",
    },
    providerByKey: {
      github: "GitHub",
      confluence: "Confluence",
      jira: "Jira",
    },
    providerDescriptionByKey: {
      github:
        "次段で OAuth エンドポイントを実装予定。ここでは provider 識別子と状態遷移を先に固定します。",
      confluence:
        "コンテキストオーバーレイ連携は、ホスト連携フロー安定化後の段階で実装します。",
      jira:
        "Issue 連携は契約上の準備のみ行い、MVP v0 の実装スコープからは外しています。",
    },
  },
} as const;

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
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
} as const;

const cardStyle = {
  border: "1px solid rgba(154, 167, 209, 0.16)",
  borderRadius: "18px",
  background: "rgba(18, 25, 51, 0.78)",
  padding: "20px",
  display: "grid",
  gap: "8px",
  minWidth: 0,
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

function formatProvider(
  provider: ConnectionProviderKey | string,
  locale: keyof typeof copyByLocale,
): string {
  return copyByLocale[locale].providerByKey[provider as ConnectionProviderKey] ?? provider;
}

function formatStatus(status: string, locale: keyof typeof copyByLocale): string {
  const translated = copyByLocale[locale].statusByKey[
    status as keyof typeof copyByLocale.en.statusByKey
  ];

  if (translated) {
    return translated;
  }

  return status.replaceAll("_", " ");
}

function formatTransitionOption(
  status: string,
  locale: keyof typeof copyByLocale,
): string {
  return formatStatus(status, locale);
}

function formatAuthMode(authMode: string, locale: keyof typeof copyByLocale): string {
  if (authMode === "oauth") {
    return "OAuth";
  }

  if (authMode === "none") {
    return locale === "ja" ? "なし" : "None";
  }

  return authMode.replaceAll("_", " ");
}

function formatStateSource(
  stateSource: "catalog_default" | "persisted",
  locale: keyof typeof copyByLocale,
): string {
  return copyByLocale[locale].stateSourceByKey[stateSource];
}

function resolveReviewerId(viewerCookie: string | undefined): string {
  const normalized = viewerCookie?.trim();

  if (!normalized) {
    return "anonymous";
  }

  return normalized;
}

function formatCapabilityFlag(enabled: boolean, locale: keyof typeof copyByLocale): string {
  if (locale === "ja") {
    return enabled ? "対応" : "未対応";
  }

  return enabled ? "Enabled" : "Disabled";
}

function formatConnectedAccountLabel(
  value: string | null,
  locale: keyof typeof copyByLocale,
): string {
  if (value) {
    return value;
  }

  return locale === "ja" ? "なし" : "None";
}

export default async function ConnectionsPage() {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const workspaceLocale = resolveWorkspaceLocale({
    preferredLocale: cookieStore.get("locus-ui-locale")?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });
  const copy = copyByLocale[workspaceLocale];
  const viewerCookie = cookieStore.get(DEMO_VIEWER_COOKIE_NAME)?.value;
  const viewerName = viewerCookie ?? copy.signedOut;
  const reviewerId = resolveReviewerId(viewerCookie);
  const connectionsWorkspace = await loadConnectionsWorkspaceDto({
    reviewerId,
  });

  return (
    <main style={pageShellStyle}>
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
          <LocalizedDateTime isoTimestamp={connectionsWorkspace.generatedAt} />
        </p>
      </section>
      <section style={cardsLayoutStyle}>
        {connectionsWorkspace.connections.map((connection) => {
          const availableTransitions = listConnectionStateTransitions(connection.status);

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
                  <LocalizedDateTime isoTimestamp={connection.statusUpdatedAt} />
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
                  {copy.transitionHistoryLabel} ({connection.recentTransitions.length})
                </summary>
                {connection.recentTransitions.length > 0 ? (
                  <ul
                    style={{
                      listStyle: "none",
                      display: "grid",
                      gap: "6px",
                      marginTop: "8px",
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
                          {copy.changedAtLabel}: <LocalizedDateTime isoTimestamp={transition.changedAt} />
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
              </details>

              {availableTransitions.length > 0 ? (
                <form
                  action={setConnectionStateAction}
                  style={{ display: "grid", gap: "8px", marginTop: "4px" }}
                >
                  <input type="hidden" name="reviewerId" value={reviewerId} />
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
