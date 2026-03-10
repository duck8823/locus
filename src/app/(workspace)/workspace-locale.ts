export type WorkspaceLocale = "ja" | "en";

function normalizeLocaleToken(value: string | null | undefined): WorkspaceLocale | null {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  if (trimmed === "ja" || trimmed.startsWith("ja-")) {
    return "ja";
  }

  if (trimmed === "en" || trimmed.startsWith("en-")) {
    return "en";
  }

  return null;
}

function parseAcceptLanguageCandidates(
  acceptLanguage: string | null | undefined,
): Array<{ localeToken: string; quality: number; index: number }> {
  const entries = (acceptLanguage ?? "")
    .split(",")
    .map((entry, index) => {
      const [localeToken = "", ...params] = entry.split(";").map((part) => part.trim());
      const qualityParam = params.find((param) => param.toLowerCase().startsWith("q="));
      const parsedQuality = qualityParam ? Number(qualityParam.slice(2)) : 1;
      const quality =
        Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1
          ? parsedQuality
          : 1;

      return {
        localeToken,
        quality,
        index,
      };
    })
    .filter((candidate) => candidate.localeToken.length > 0);

  return entries.sort((left, right) => {
    if (right.quality !== left.quality) {
      return right.quality - left.quality;
    }

    return left.index - right.index;
  });
}

export function resolveWorkspaceLocale(input: {
  preferredLocale?: string | null;
  acceptLanguage?: string | null;
}): WorkspaceLocale {
  const preferredLocale = normalizeLocaleToken(input.preferredLocale);

  if (preferredLocale) {
    return preferredLocale;
  }

  const acceptedTokens = parseAcceptLanguageCandidates(input.acceptLanguage);

  for (const acceptedToken of acceptedTokens) {
    const normalized = normalizeLocaleToken(acceptedToken.localeToken);

    if (normalized) {
      return normalized;
    }
  }

  return "en";
}
