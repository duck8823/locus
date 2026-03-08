export class ReanalyzeSourceUnavailableError extends Error {
  readonly code = "REANALYZE_SOURCE_UNAVAILABLE";

  constructor(readonly reviewId: string) {
    super(`Reanalysis source is not available for review session: ${reviewId}`);
    this.name = "ReanalyzeSourceUnavailableError";
  }
}
