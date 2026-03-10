import { describe, expect, it } from "vitest";
import { resolveAnalysisPollIntervalMs } from "./analysis-status-polling-policy";

describe("resolveAnalysisPollIntervalMs", () => {
  it("uses a long interval while the document is hidden", () => {
    expect(
      resolveAnalysisPollIntervalMs({
        analysisStatus: "parsing",
        analysisProcessedFiles: 90,
        analysisTotalFiles: 100,
        isDocumentVisible: false,
      }),
    ).toBe(15000);
  });

  it("polls faster during fetch/parsing than queued", () => {
    expect(
      resolveAnalysisPollIntervalMs({
        analysisStatus: "fetching",
        analysisProcessedFiles: null,
        analysisTotalFiles: null,
        isDocumentVisible: true,
      }),
    ).toBe(1500);
    expect(
      resolveAnalysisPollIntervalMs({
        analysisStatus: "queued",
        analysisProcessedFiles: null,
        analysisTotalFiles: null,
        isDocumentVisible: true,
      }),
    ).toBe(2200);
  });

  it("polls most aggressively near parsing completion", () => {
    expect(
      resolveAnalysisPollIntervalMs({
        analysisStatus: "parsing",
        analysisProcessedFiles: 95,
        analysisTotalFiles: 100,
        isDocumentVisible: true,
      }),
    ).toBe(1200);
    expect(
      resolveAnalysisPollIntervalMs({
        analysisStatus: "parsing",
        analysisProcessedFiles: 20,
        analysisTotalFiles: 100,
        isDocumentVisible: true,
      }),
    ).toBe(1800);
  });

  it("polls while reanalysis is running even after initial analysis is ready", () => {
    expect(
      resolveAnalysisPollIntervalMs({
        analysisStatus: "ready",
        reanalysisStatus: "running",
        analysisProcessedFiles: null,
        analysisTotalFiles: null,
        isDocumentVisible: true,
      }),
    ).toBe(1700);
  });

  it("uses a relaxed interval while idle", () => {
    expect(
      resolveAnalysisPollIntervalMs({
        analysisStatus: "ready",
        reanalysisStatus: "idle",
        analysisProcessedFiles: null,
        analysisTotalFiles: null,
        isDocumentVisible: true,
      }),
    ).toBe(10000);
  });
});
