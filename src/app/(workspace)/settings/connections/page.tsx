import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LocalizedDateTime } from "@/app/components/localized-date-time";
import { resolveWorkspaceLocale } from "@/app/(workspace)/workspace-locale";
import type {
  ConnectionProviderKey,
  ConnectionStatus,
} from "@/server/application/services/connection-catalog";
import { loadConnectionsWorkspaceDto } from "@/server/presentation/api/load-connections-workspace";
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
    statusByKey: {
      not_connected: "Not connected",
      planned: "Planned",
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
    statusByKey: {
      not_connected: "未接続",
      planned: "計画中",
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

function formatProvider(
  provider: ConnectionProviderKey,
  locale: keyof typeof copyByLocale,
): string {
  return copyByLocale[locale].providerByKey[provider];
}

function formatStatus(
  status: ConnectionStatus,
  locale: keyof typeof copyByLocale,
): string {
  return copyByLocale[locale].statusByKey[status];
}

function formatAuthMode(
  authMode: "oauth" | "none",
  locale: keyof typeof copyByLocale,
): string {
  if (authMode === "oauth") {
    return "OAuth";
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
  const viewerName = cookieStore.get("locus-demo-viewer")?.value ?? copy.signedOut;
  const connectionsWorkspace = await loadConnectionsWorkspaceDto();

  return (
    <main
      style={{
        maxWidth: "960px",
        margin: "0 auto",
        padding: "48px 24px 72px",
        display: "grid",
        gap: "20px",
      }}
    >
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
      <section
        style={{
          border: "1px solid #2a3563",
          borderRadius: "24px",
          background: "rgba(18, 25, 51, 0.88)",
          padding: "28px",
        }}
      >
        <p style={{ color: "#9aa7d1", marginBottom: "12px" }}>{copy.authStub}</p>
        <h1 style={{ fontSize: "36px", marginBottom: "12px" }}>{copy.title}</h1>
        <p style={{ color: "#9aa7d1", marginBottom: "18px" }}>
          {copy.description}
        </p>
        <p style={{ marginBottom: "8px" }}>
          {copy.reviewerIdentity}: <strong>{viewerName}</strong>
        </p>
        <p style={{ color: "#9aa7d1", marginBottom: "0px" }}>
          {copy.generatedAt}:{" "}
          <LocalizedDateTime isoTimestamp={connectionsWorkspace.generatedAt} />
        </p>
      </section>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
        }}
      >
        {connectionsWorkspace.connections.map((connection) => (
          <article
            key={connection.provider}
            style={{
              border: "1px solid rgba(154, 167, 209, 0.16)",
              borderRadius: "18px",
              background: "rgba(18, 25, 51, 0.78)",
              padding: "20px",
              display: "grid",
              gap: "8px",
            }}
          >
            <h2 style={{ marginBottom: "0px" }}>
              {formatProvider(connection.provider, workspaceLocale)}
            </h2>
            <p style={{ color: "#9aa7d1" }}>
              {copy.statusLabel}: {formatStatus(connection.status, workspaceLocale)}
            </p>
            <p style={{ color: "#9aa7d1" }}>
              {copy.authModeLabel}: {formatAuthMode(connection.authMode, workspaceLocale)}
            </p>
            <p style={{ color: "#9aa7d1", marginBottom: "0px" }}>
              {copy.providerDescriptionByKey[connection.provider]}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
