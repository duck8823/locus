export interface ResolveAnalysisPollIntervalInput {
  analysisStatus: string;
  reanalysisStatus?: string;
  analysisProcessedFiles: number | null | undefined;
  analysisTotalFiles: number | null | undefined;
  isDocumentVisible: boolean;
}

function normalizeCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.floor(value);
}

export function resolveAnalysisPollIntervalMs(
  input: ResolveAnalysisPollIntervalInput,
): number {
  if (!input.isDocumentVisible) {
    return 15000;
  }

  if (input.analysisStatus === "fetching") {
    return 1500;
  }

  if (input.analysisStatus === "queued") {
    return 2200;
  }

  if (input.analysisStatus === "parsing") {
    const totalFiles = normalizeCount(input.analysisTotalFiles);
    const processedFiles = normalizeCount(input.analysisProcessedFiles);

    if (
      totalFiles !== null &&
      totalFiles > 0 &&
      processedFiles !== null &&
      processedFiles >= totalFiles * 0.9
    ) {
      return 1200;
    }

    return 1800;
  }

  if (input.reanalysisStatus === "running") {
    return 1700;
  }

  if (input.reanalysisStatus === "queued") {
    return 2200;
  }

  return 10000;
}
