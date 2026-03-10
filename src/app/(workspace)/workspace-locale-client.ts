import type { WorkspaceLocale } from "@/app/(workspace)/workspace-locale";

const localeCookiePattern = /(?:^|;\s*)locus-ui-locale=([^;]+)/;

export function resolveWorkspaceLocaleFromCookieString(
  cookieHeader: string | null | undefined,
): WorkspaceLocale {
  const match = localeCookiePattern.exec(cookieHeader ?? "");
  const rawValue = match?.[1] ?? "";
  const decodedValue = decodeURIComponent(rawValue).trim().toLowerCase();

  if (decodedValue === "ja" || decodedValue.startsWith("ja-")) {
    return "ja";
  }

  if (decodedValue === "en" || decodedValue.startsWith("en-")) {
    return "en";
  }

  return "en";
}
