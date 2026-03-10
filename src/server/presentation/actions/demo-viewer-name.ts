export type DemoViewerLocale = "ja" | "en";

function normalizeLocaleToken(value: string | null | undefined): DemoViewerLocale | null {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "ja" || normalized.startsWith("ja-")) {
    return "ja";
  }

  if (normalized === "en" || normalized.startsWith("en-")) {
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

export function resolveDemoViewerLocale(input: {
  preferredLocale?: string | null;
  acceptLanguage?: string | null;
}): DemoViewerLocale {
  const preferredLocale = normalizeLocaleToken(input.preferredLocale);

  if (preferredLocale) {
    return preferredLocale;
  }

  for (const acceptedToken of parseAcceptLanguageCandidates(input.acceptLanguage)) {
    const locale = normalizeLocaleToken(acceptedToken.localeToken);

    if (locale) {
      return locale;
    }
  }

  return "en";
}

export function resolveDemoViewerName(input: {
  preferredLocale?: string | null;
  acceptLanguage?: string | null;
}): string {
  return resolveDemoViewerLocale(input) === "ja" ? "デモレビュアー" : "Demo reviewer";
}
