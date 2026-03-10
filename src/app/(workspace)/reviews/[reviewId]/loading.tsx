import { cookies, headers } from "next/headers";
import { resolveWorkspaceLocale } from "@/app/(workspace)/workspace-locale";

const loadingTextByLocale = {
  en: "Loading review workspace…",
  ja: "レビュー画面を読み込み中…",
} as const;

export default async function ReviewWorkspaceLoading() {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const workspaceLocale = resolveWorkspaceLocale({
    preferredLocale: cookieStore.get("locus-ui-locale")?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });

  return (
    <main style={{ padding: "64px 24px", textAlign: "center", color: "#9aa7d1" }}>
      {loadingTextByLocale[workspaceLocale]}
    </main>
  );
}
