import { cookies, headers } from "next/headers";
import Link from "next/link";
import styles from "./page.module.css";
import { resolveWorkspaceLocale, type WorkspaceLocale } from "@/app/(workspace)/workspace-locale";
import { parseGitHubDemoErrorCode, type GitHubDemoErrorCode } from "@/server/presentation/actions/github-demo-error-code";
import {
  parseGitLabDemoErrorCode,
  type GitLabDemoErrorCode,
} from "@/server/presentation/actions/gitlab-demo-error-code";
import { startDemoSessionAction } from "@/server/presentation/actions/start-demo-session-action";
import { startGitHubDemoSessionAction } from "@/server/presentation/actions/start-github-demo-session-action";
import { startGitLabDemoSessionAction } from "@/server/presentation/actions/start-gitlab-demo-session-action";
import { setWorkspaceLocaleAction } from "@/server/presentation/actions/set-workspace-locale-action";

interface MarketingPageSearchParams {
  githubDemoError?: string | string[];
  githubDemoErrorCode?: string | string[];
  gitlabDemoError?: string | string[];
  gitlabDemoErrorCode?: string | string[];
}

function resolveSearchParamValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

const githubDemoErrorCopyByLocale: Record<WorkspaceLocale, Record<GitHubDemoErrorCode, string>> = {
  en: {
    owner_required: "GitHub owner is required.",
    repository_required: "GitHub repository is required.",
    pull_request_number_required: "GitHub PR number is required.",
    pull_request_number_invalid: "GitHub PR number must be a positive integer.",
    start_failed: "Failed to open GitHub demo. Check your inputs and try again.",
  },
  ja: {
    owner_required: "GitHub オーナーを入力してください。",
    repository_required: "GitHub リポジトリを入力してください。",
    pull_request_number_required: "GitHub PR 番号を入力してください。",
    pull_request_number_invalid: "GitHub PR 番号は 1 以上の整数で入力してください。",
    start_failed: "GitHub デモを開始できませんでした。入力内容を確認して再試行してください。",
  },
};

const gitlabDemoErrorCopyByLocale: Record<WorkspaceLocale, Record<GitLabDemoErrorCode, string>> = {
  en: {
    project_path_required: "GitLab project path is required.",
    merge_request_iid_required: "GitLab merge request IID is required.",
    merge_request_iid_invalid: "GitLab merge request IID must be a positive integer.",
    start_failed: "Failed to open GitLab demo. Check your inputs and try again.",
  },
  ja: {
    project_path_required: "GitLab プロジェクトパスを入力してください。",
    merge_request_iid_required: "GitLab MR IID を入力してください。",
    merge_request_iid_invalid: "GitLab MR IID は 1 以上の整数で入力してください。",
    start_failed: "GitLab デモを開始できませんでした。入力内容を確認して再試行してください。",
  },
};

const marketingCopyByLocale = {
  en: {
    languageLabel: "Language",
    switchToJapanese: "日本語",
    switchToEnglish: "English",
    kicker: "Slice 1 · Workspace demo",
    title: "Open a PR review workspace in seconds.",
    lead:
      "Start from the seed demo or any public GitHub/GitLab change request. Initial analysis runs asynchronously.",
    openSeedDemo: "Open seed demo",
    openConnections: "Connection settings",
    githubDemoCardTitle: "GitHub pull request",
    githubOwnerLabel: "GitHub owner",
    githubOwnerPlaceholder: "octocat",
    repositoryLabel: "Repository",
    repositoryPlaceholder: "Hello-World",
    pullRequestNumberLabel: "PR number",
    pullRequestNumberPlaceholder: "123",
    openGitHubDemo: "Open GitHub demo",
    gitlabDemoCardTitle: "GitLab merge request",
    gitlabProjectPathLabel: "Project path",
    gitlabProjectPathPlaceholder: "gitlab-org/gitlab",
    gitlabMergeRequestIidLabel: "MR IID",
    gitlabMergeRequestIidPlaceholder: "123",
    openGitLabDemo: "Open GitLab demo",
    hints: [
      "Public repositories can run without GITHUB_TOKEN / GITLAB_TOKEN (with stricter rate limits).",
      "Workspace opens first; analysis continues in the background.",
      "Environment variables can provide optional defaults.",
    ],
    sidePanelTitle: "What works today",
    sidePanelItems: [
      {
        label: "Auth stub",
        description: "Reviewer identity is stored in a cookie.",
      },
      {
        label: "Workspace state",
        description: "Selected group and status are stored in file persistence.",
      },
      {
        label: "BFF boundary",
        description: "Route handlers stay thin and delegate to use cases.",
      },
    ],
    cards: [
      {
        title: "Layered server",
        description: "Domain/application/presentation/infrastructure boundaries are runnable.",
      },
      {
        title: "Async analysis UX",
        description: "Workspace opening is immediate while queue ingestion and analysis continue.",
      },
      {
        title: "Next step",
        description:
          "Expand parser coverage and semantic grouping depth while keeping progress persistence.",
      },
    ],
  },
  ja: {
    languageLabel: "表示言語",
    switchToJapanese: "日本語",
    switchToEnglish: "English",
    kicker: "Slice 1 · ワークスペースデモ",
    title: "PR レビュー画面をすぐに開けます。",
    lead:
      "シードデモまたは public GitHub/GitLab change request から開始できます。初回解析は非同期で進みます。",
    openSeedDemo: "シードデモを開く",
    openConnections: "接続設定",
    githubDemoCardTitle: "GitHub pull request",
    githubOwnerLabel: "GitHub オーナー",
    githubOwnerPlaceholder: "octocat",
    repositoryLabel: "リポジトリ",
    repositoryPlaceholder: "Hello-World",
    pullRequestNumberLabel: "PR 番号",
    pullRequestNumberPlaceholder: "123",
    openGitHubDemo: "GitHub デモを開く",
    gitlabDemoCardTitle: "GitLab マージリクエスト",
    gitlabProjectPathLabel: "プロジェクトパス",
    gitlabProjectPathPlaceholder: "gitlab-org/gitlab",
    gitlabMergeRequestIidLabel: "MR IID",
    gitlabMergeRequestIidPlaceholder: "123",
    openGitLabDemo: "GitLab デモを開く",
    hints: [
      "public リポジトリは GITHUB_TOKEN / GITLAB_TOKEN なしでも利用できます（レート制限は厳しくなります）。",
      "ワークスペースを先に開き、解析はバックグラウンドで続行します。",
      "環境変数でフォーム初期値を任意設定できます。",
    ],
    sidePanelTitle: "現時点で使える機能",
    sidePanelItems: [
      {
        label: "認証スタブ",
        description: "レビュアーIDを cookie に保存します。",
      },
      {
        label: "ワークスペース状態",
        description: "選択中グループとレビュー状態をファイル保存で保持します。",
      },
      {
        label: "BFF 境界",
        description: "App Router は薄く保ち、ユースケースへ委譲します。",
      },
    ],
    cards: [
      {
        title: "レイヤードサーバー",
        description: "Domain/Application/Presentation/Infrastructure の境界を確認できます。",
      },
      {
        title: "非同期解析 UX",
        description: "画面を即表示し、取り込み・解析はキューで継続します。",
      },
      {
        title: "次のステップ",
        description: "進捗保持を維持したまま、パーサー対応と差分解析の深さを拡張します。",
      },
    ],
  },
} as const;

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<MarketingPageSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const headerStore = await headers();
  const cookieStore = await cookies();
  const defaultGitHubOwner = process.env.LOCUS_GITHUB_DEMO_OWNER ?? "";
  const defaultGitHubRepository = process.env.LOCUS_GITHUB_DEMO_REPO ?? "";
  const defaultGitHubPullRequestNumber = process.env.LOCUS_GITHUB_DEMO_PR_NUMBER ?? "";
  const defaultGitLabProjectPath = process.env.LOCUS_GITLAB_DEMO_PROJECT_PATH ?? "";
  const defaultGitLabMergeRequestIid = process.env.LOCUS_GITLAB_DEMO_MERGE_REQUEST_IID ?? "";
  const workspaceLocale = resolveWorkspaceLocale({
    preferredLocale: cookieStore.get("locus-ui-locale")?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });
  const copy = marketingCopyByLocale[workspaceLocale];
  const githubDemoErrorCode = parseGitHubDemoErrorCode(
    resolveSearchParamValue(resolvedSearchParams.githubDemoErrorCode),
  );
  const legacyGithubDemoError = resolveSearchParamValue(resolvedSearchParams.githubDemoError);
  const githubDemoError = githubDemoErrorCode
    ? githubDemoErrorCopyByLocale[workspaceLocale][githubDemoErrorCode]
    : legacyGithubDemoError;
  const gitLabDemoErrorCode = parseGitLabDemoErrorCode(
    resolveSearchParamValue(resolvedSearchParams.gitlabDemoErrorCode),
  );
  const legacyGitLabDemoError = resolveSearchParamValue(resolvedSearchParams.gitlabDemoError);
  const gitLabDemoError = gitLabDemoErrorCode
    ? gitlabDemoErrorCopyByLocale[workspaceLocale][gitLabDemoErrorCode]
    : legacyGitLabDemoError;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.topBar} aria-label={copy.languageLabel}>
          <div className={styles.localeSwitcher}>
            <form action={setWorkspaceLocaleAction}>
              <input name="redirectPath" type="hidden" value="/" />
              <input name="locale" type="hidden" value="ja" />
              <button
                className={styles.localeButton}
                data-active={workspaceLocale === "ja"}
                type="submit"
                data-testid="marketing-locale-ja"
              >
                {copy.switchToJapanese}
              </button>
            </form>
            <form action={setWorkspaceLocaleAction}>
              <input name="redirectPath" type="hidden" value="/" />
              <input name="locale" type="hidden" value="en" />
              <button
                className={styles.localeButton}
                data-active={workspaceLocale === "en"}
                type="submit"
                data-testid="marketing-locale-en"
              >
                {copy.switchToEnglish}
              </button>
            </form>
          </div>
        </section>

        <section className={styles.hero}>
          <div className={styles.panel}>
            <span className={styles.kicker}>{copy.kicker}</span>
            <h1>{copy.title}</h1>
            <p className={styles.lead}>{copy.lead}</p>

            <div className={styles.ctas}>
              <form action={startDemoSessionAction}>
                <button
                  className={styles.primaryButton}
                  type="submit"
                  data-testid="open-seed-demo"
                >
                  {copy.openSeedDemo}
                </button>
              </form>
              <Link className={styles.secondaryLink} href="/settings/connections">
                {copy.openConnections}
              </Link>
            </div>

            <div className={styles.codeHostDemoGrid}>
              <section className={styles.codeHostDemoCard}>
                <h2 className={styles.codeHostDemoTitle}>{copy.githubDemoCardTitle}</h2>
                <form action={startGitHubDemoSessionAction} className={styles.codeHostDemoForm}>
                  <label className={styles.codeHostDemoField}>
                    <span>{copy.githubOwnerLabel}</span>
                    <input
                      autoComplete="off"
                      defaultValue={defaultGitHubOwner}
                      name="owner"
                      placeholder={copy.githubOwnerPlaceholder}
                      required
                      type="text"
                    />
                  </label>
                  <label className={styles.codeHostDemoField}>
                    <span>{copy.repositoryLabel}</span>
                    <input
                      autoComplete="off"
                      defaultValue={defaultGitHubRepository}
                      name="repository"
                      placeholder={copy.repositoryPlaceholder}
                      required
                      type="text"
                    />
                  </label>
                  <label className={styles.codeHostDemoField}>
                    <span>{copy.pullRequestNumberLabel}</span>
                    <input
                      autoComplete="off"
                      defaultValue={defaultGitHubPullRequestNumber}
                      min={1}
                      name="pullRequestNumber"
                      placeholder={copy.pullRequestNumberPlaceholder}
                      required
                      type="number"
                    />
                  </label>
                  <button
                    className={styles.secondaryButton}
                    type="submit"
                    data-testid="open-github-demo"
                  >
                    {copy.openGitHubDemo}
                  </button>
                </form>
                {githubDemoError ? <p className={styles.errorBanner}>{githubDemoError}</p> : null}
              </section>

              <section className={styles.codeHostDemoCard}>
                <h2 className={styles.codeHostDemoTitle}>{copy.gitlabDemoCardTitle}</h2>
                <form action={startGitLabDemoSessionAction} className={styles.codeHostDemoForm}>
                  <label className={styles.codeHostDemoField}>
                    <span>{copy.gitlabProjectPathLabel}</span>
                    <input
                      autoComplete="off"
                      defaultValue={defaultGitLabProjectPath}
                      name="projectPath"
                      placeholder={copy.gitlabProjectPathPlaceholder}
                      required
                      type="text"
                    />
                  </label>
                  <label className={styles.codeHostDemoField}>
                    <span>{copy.gitlabMergeRequestIidLabel}</span>
                    <input
                      autoComplete="off"
                      defaultValue={defaultGitLabMergeRequestIid}
                      min={1}
                      name="mergeRequestIid"
                      placeholder={copy.gitlabMergeRequestIidPlaceholder}
                      required
                      type="number"
                    />
                  </label>
                  <button
                    className={styles.secondaryButton}
                    type="submit"
                    data-testid="open-gitlab-demo"
                  >
                    {copy.openGitLabDemo}
                  </button>
                </form>
                {gitLabDemoError ? <p className={styles.errorBanner}>{gitLabDemoError}</p> : null}
              </section>
            </div>

            <ul className={styles.demoHintList}>
              {copy.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          </div>

          <aside className={styles.sidePanel}>
            <div>
              <h2>{copy.sidePanelTitle}</h2>
              <ul>
                {copy.sidePanelItems.map((item) => (
                  <li key={item.label}>
                    <span className={styles.sideLabel}>{item.label}</span>
                    {item.description}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </section>

        <section className={styles.cards}>
          {copy.cards.map((card) => (
            <article className={styles.card} key={card.title}>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
