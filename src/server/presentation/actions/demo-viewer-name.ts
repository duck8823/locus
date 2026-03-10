export function resolveDemoViewerName(locale: string | null | undefined): string {
  const normalized = locale?.trim().toLowerCase();

  if (normalized === "ja" || normalized?.startsWith("ja-")) {
    return "デモレビュアー";
  }

  return "Demo reviewer";
}
