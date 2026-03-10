"use client";

import { useMemo } from "react";
import { resolveWorkspaceLocale } from "@/app/(workspace)/workspace-locale";
import { readWorkspaceLocaleFromCookieString } from "@/app/(workspace)/workspace-locale-client";

const errorCopyByLocale = {
  en: {
    title: "Workspace failed to load",
    retry: "Try again",
  },
  ja: {
    title: "レビュー画面の読み込みに失敗しました",
    retry: "再試行",
  },
} as const;

export default function ReviewWorkspaceError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const workspaceLocale = useMemo(() => {
    if (typeof document === "undefined") {
      return "en";
    }

    const localeFromCookie = readWorkspaceLocaleFromCookieString(document.cookie);

    if (localeFromCookie) {
      return localeFromCookie;
    }

    return resolveWorkspaceLocale({
      preferredLocale: null,
      acceptLanguage: navigator.languages?.join(",") || navigator.language || null,
    });
  }, []);
  const copy = errorCopyByLocale[workspaceLocale];

  return (
    <main style={{ padding: "64px 24px", maxWidth: "720px", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "12px" }}>{copy.title}</h1>
      <p style={{ color: "#9aa7d1", marginBottom: "20px" }}>{error.message}</p>
      <button
        onClick={reset}
        style={{
          border: "none",
          borderRadius: "12px",
          padding: "12px 18px",
          background: "#5e7bff",
          color: "white",
        }}
        type="button"
      >
        {copy.retry}
      </button>
    </main>
  );
}
