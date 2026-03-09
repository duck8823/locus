export const reviewAnalysisStatuses = [
  "queued",
  "fetching",
  "parsing",
  "ready",
  "failed",
] as const;

export type ReviewAnalysisStatus = (typeof reviewAnalysisStatuses)[number];
