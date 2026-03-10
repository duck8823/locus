import type { WorkspaceLocale } from "@/app/(workspace)/workspace-locale";

const localeCookiePattern = /(?:^|;\s*)locus-ui-locale=([^;]+)/;

export function readWorkspaceLocaleFromCookieString(
  cookieHeader: string | null | undefined,
): WorkspaceLocale | null {
  const match = localeCookiePattern.exec(cookieHeader ?? "");

  if (!match) {
    return null;
  }

  const rawValue = match?.[1] ?? "";
  let decodedValue = "";

  try {
    decodedValue = decodeURIComponent(rawValue).trim().toLowerCase();
  } catch {
    return null;
  }

  if (decodedValue === "ja" || decodedValue.startsWith("ja-")) {
    return "ja";
  }

  if (decodedValue === "en" || decodedValue.startsWith("en-")) {
    return "en";
  }

  return null;
}

export function resolveWorkspaceLocaleFromCookieString(
  cookieHeader: string | null | undefined,
): WorkspaceLocale {
  return readWorkspaceLocaleFromCookieString(cookieHeader) ?? "en";
}
