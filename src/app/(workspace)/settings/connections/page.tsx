import { cookies, headers } from "next/headers";
import Link from "next/link";
import { resolveWorkspaceLocale } from "@/app/(workspace)/workspace-locale";
import { setWorkspaceLocaleAction } from "@/server/presentation/actions/set-workspace-locale-action";

const copyByLocale = {
  en: {
    backToHome: "← Back to home",
    title: "Connections",
    authStub: "Auth stub",
    description:
      "This is a placeholder for future GitHub / issue-tracker / document integrations.",
    reviewerIdentity: "Current reviewer identity",
    signedOut: "Signed out",
    languageLabel: "Language",
    switchToJapanese: "日本語",
    switchToEnglish: "English",
    cards: [
      ["GitHub", "OAuth flow not implemented yet"],
      ["Confluence", "Context overlay arrives in a later slice"],
      ["Jira", "Issue linkage is outside the first web shell"],
    ],
  },
  ja: {
    backToHome: "← ホームへ戻る",
    title: "接続設定",
    authStub: "認証スタブ",
    description:
      "このページは将来の GitHub / 課題管理 / ドキュメント連携用プレースホルダーです。",
    reviewerIdentity: "現在のレビュアーID",
    signedOut: "未ログイン",
    languageLabel: "表示言語",
    switchToJapanese: "日本語",
    switchToEnglish: "English",
    cards: [
      ["GitHub", "OAuth フローはまだ未実装です"],
      ["Confluence", "コンテキストオーバーレイは後続スライスで対応します"],
      ["Jira", "Issue 連携は初期 Web シェルのスコープ外です"],
    ],
  },
} as const;

export default async function ConnectionsPage() {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const workspaceLocale = resolveWorkspaceLocale({
    preferredLocale: cookieStore.get("locus-ui-locale")?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });
  const copy = copyByLocale[workspaceLocale];
  const viewerName = cookieStore.get("locus-demo-viewer")?.value ?? copy.signedOut;

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
        <p>
          {copy.reviewerIdentity}: <strong>{viewerName}</strong>
        </p>
      </section>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
        }}
      >
        {copy.cards.map(([title, summary]) => (
          <article
            key={title}
            style={{
              border: "1px solid rgba(154, 167, 209, 0.16)",
              borderRadius: "18px",
              background: "rgba(18, 25, 51, 0.78)",
              padding: "20px",
            }}
          >
            <h2 style={{ marginBottom: "8px" }}>{title}</h2>
            <p style={{ color: "#9aa7d1" }}>{summary}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
