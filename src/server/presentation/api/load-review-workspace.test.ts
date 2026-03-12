import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDependenciesMock,
  executeMock,
  toReviewWorkspaceDtoMock,
  loadActiveInitialAnalysisJobMock,
  loadActiveManualReanalysisJobMock,
  loadAnalysisJobHistoryMock,
  resolveEffectiveReanalysisStateMock,
} = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  executeMock: vi.fn(),
  toReviewWorkspaceDtoMock: vi.fn(),
  loadActiveInitialAnalysisJobMock: vi.fn(),
  loadActiveManualReanalysisJobMock: vi.fn(),
  loadAnalysisJobHistoryMock: vi.fn(),
  resolveEffectiveReanalysisStateMock: vi.fn(),
}));

vi.mock("@/server/composition/dependencies", () => ({
  getDependencies: getDependenciesMock,
}));

vi.mock("@/server/application/usecases/get-review-workspace", () => ({
  GetReviewWorkspaceUseCase: class {
    async execute(input: { reviewId: string }) {
      return executeMock(input);
    }
  },
}));

vi.mock("@/server/presentation/mappers/to-review-workspace-dto", () => ({
  toReviewWorkspaceDto: toReviewWorkspaceDtoMock,
}));

vi.mock("@/server/presentation/api/load-active-initial-analysis-job", () => ({
  loadActiveInitialAnalysisJob: loadActiveInitialAnalysisJobMock,
}));

vi.mock("@/server/presentation/api/load-active-manual-reanalysis-job", () => ({
  loadActiveManualReanalysisJob: loadActiveManualReanalysisJobMock,
}));

vi.mock("@/server/presentation/api/load-analysis-job-history", () => ({
  loadAnalysisJobHistory: loadAnalysisJobHistoryMock,
}));

vi.mock("@/server/presentation/formatters/effective-reanalysis-state", () => ({
  resolveEffectiveReanalysisState: resolveEffectiveReanalysisStateMock,
}));

import { loadReviewWorkspaceDto } from "@/server/presentation/api/load-review-workspace";

describe("loadReviewWorkspaceDto", () => {
  beforeEach(() => {
    getDependenciesMock.mockReset();
    executeMock.mockReset();
    toReviewWorkspaceDtoMock.mockReset();
    loadActiveInitialAnalysisJobMock.mockReset();
    loadActiveManualReanalysisJobMock.mockReset();
    loadAnalysisJobHistoryMock.mockReset();
    resolveEffectiveReanalysisStateMock.mockReset();
    const loadSnapshotForReviewMock = vi.fn().mockResolvedValue({
      generatedAt: "2026-03-12T00:00:00.000Z",
      provider: "stub",
      items: [],
    });
    getDependenciesMock.mockReturnValue({
      reviewSessionRepository: {},
      analysisJobScheduler: {},
      businessContextProvider: {
        loadSnapshotForReview: loadSnapshotForReviewMock,
      },
    });
    executeMock.mockResolvedValue({
      id: "review-session",
      toRecord: () => ({
        reviewId: "review-1",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/123-scope -> main",
        title: "Demo workspace",
        source: null,
      }),
    });
    toReviewWorkspaceDtoMock.mockReturnValue({
      reviewId: "review-1",
      reanalysisStatus: "idle",
      lastReanalyzeRequestedAt: null,
      analysisHistory: [],
      dogfoodingMetrics: {
        averageDurationMs: null,
        failureRatePercent: null,
        recoverySuccessRatePercent: null,
      },
      businessContext: {
        generatedAt: "2026-03-12T00:00:00.000Z",
        provider: "stub",
        diagnostics: {
          status: "ok",
          retryable: true,
          message: null,
          occurredAt: null,
        },
        items: [],
      },
    });
    loadActiveManualReanalysisJobMock.mockResolvedValue(null);
    loadAnalysisJobHistoryMock.mockResolvedValue({
      history: [],
      metrics: {
        averageDurationMs: null,
        failureRatePercent: null,
        recoverySuccessRatePercent: null,
      },
    });
    resolveEffectiveReanalysisStateMock.mockReturnValue({
      reanalysisStatus: "idle",
      lastReanalyzeRequestedAt: null,
    });
  });

  it("injects active initial-analysis job snapshot", async () => {
    loadActiveInitialAnalysisJobMock.mockResolvedValue({
      jobId: "job-1",
      reviewId: "review-1",
      requestedAt: "2026-03-11T00:00:00.000Z",
      reason: "initial_ingestion",
      status: "running",
      queuedAt: "2026-03-11T00:00:00.000Z",
      startedAt: "2026-03-11T00:00:01.000Z",
    });

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.activeAnalysisJob).toEqual({
      jobId: "job-1",
      reason: "initial_ingestion",
      status: "running",
      requestedAt: "2026-03-11T00:00:00.000Z",
      queuedAt: "2026-03-11T00:00:00.000Z",
      startedAt: "2026-03-11T00:00:01.000Z",
    });
    expect(dto.analysisHistory).toEqual([]);
    expect(dto.dogfoodingMetrics).toEqual({
      averageDurationMs: null,
      failureRatePercent: null,
      recoverySuccessRatePercent: null,
    });
    expect(dto.businessContext).toEqual({
      generatedAt: "2026-03-12T00:00:00.000Z",
      provider: "stub",
      diagnostics: {
        status: "ok",
        retryable: true,
        message: null,
        occurredAt: null,
      },
      items: [],
    });
    expect(
      getDependenciesMock.mock.results[0]?.value.businessContextProvider.loadSnapshotForReview,
    ).toHaveBeenCalledWith({
      reviewId: "review-1",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/123-scope -> main",
      title: "Demo workspace",
      source: null,
    });
  });

  it("keeps activeAnalysisJob null when scheduler snapshot is unavailable", async () => {
    loadActiveInitialAnalysisJobMock.mockResolvedValue(null);

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.activeAnalysisJob).toBeNull();
  });

  it("maps business-context confidence and inference-source fields", async () => {
    const loadSnapshotForReviewMock = vi.fn().mockResolvedValue({
      generatedAt: "2026-03-12T00:00:00.000Z",
      provider: "stub",
      items: [
        {
          contextId: "ctx-1",
          sourceType: "github_issue",
          status: "candidate",
          confidence: "medium",
          inferenceSource: "branch_pattern",
          title: "Candidate issue: octocat/locus#451",
          summary: "Detected from branch naming convention.",
          href: "https://github.com/octocat/locus/issues/451",
        },
      ],
    });
    getDependenciesMock.mockReturnValueOnce({
      reviewSessionRepository: {},
      analysisJobScheduler: {},
      businessContextProvider: {
        loadSnapshotForReview: loadSnapshotForReviewMock,
      },
    });

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.businessContext.items).toEqual([
      {
        contextId: "ctx-1",
        sourceType: "github_issue",
        status: "candidate",
        confidence: "medium",
        inferenceSource: "branch_pattern",
        title: "Candidate issue: octocat/locus#451",
        summary: "Detected from branch naming convention.",
        href: "https://github.com/octocat/locus/issues/451",
      },
    ]);
    expect(dto.businessContext.diagnostics).toEqual({
      status: "ok",
      retryable: true,
      message: null,
      occurredAt: null,
    });
  });

  it("injects analysis-history snapshots and derived dogfooding metrics", async () => {
    loadAnalysisJobHistoryMock.mockResolvedValueOnce({
      history: [
        {
          jobId: "job-1",
          reason: "manual_reanalysis",
          status: "failed",
          queuedAt: "2026-03-12T00:00:01.000Z",
          startedAt: "2026-03-12T00:00:02.000Z",
          completedAt: "2026-03-12T00:00:04.000Z",
          durationMs: 2000,
          attempts: 2,
          lastError: "temporary timeout",
        },
      ],
      metrics: {
        averageDurationMs: 2500,
        failureRatePercent: 50,
        recoverySuccessRatePercent: 50,
      },
    });

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.analysisHistory).toEqual([
      {
        jobId: "job-1",
        reason: "manual_reanalysis",
        status: "failed",
        queuedAt: "2026-03-12T00:00:01.000Z",
        startedAt: "2026-03-12T00:00:02.000Z",
        completedAt: "2026-03-12T00:00:04.000Z",
        durationMs: 2000,
        attempts: 2,
        lastError: "temporary timeout",
      },
    ]);
    expect(dto.dogfoodingMetrics).toEqual({
      averageDurationMs: 2500,
      failureRatePercent: 50,
      recoverySuccessRatePercent: 50,
    });
  });

  it("falls back to diagnostic business context when provider throws", async () => {
    getDependenciesMock.mockReturnValueOnce({
      reviewSessionRepository: {},
      analysisJobScheduler: {},
      businessContextProvider: {
        loadSnapshotForReview: vi.fn().mockRejectedValue(new Error("context timeout")),
      },
    });

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.businessContext.provider).toBe("fallback");
    expect(dto.businessContext.diagnostics.status).toBe("fallback");
    expect(dto.businessContext.diagnostics.retryable).toBe(true);
    expect(dto.businessContext.diagnostics.message).toBe("context timeout");
    expect(dto.businessContext.items[0]).toMatchObject({
      status: "unavailable",
      sourceType: "github_issue",
      inferenceSource: "none",
    });
  });

  it("injects analysis-history snapshots and derived dogfooding metrics", async () => {
    loadAnalysisJobHistoryMock.mockResolvedValueOnce({
      history: [
        {
          jobId: "job-1",
          reason: "manual_reanalysis",
          status: "failed",
          queuedAt: "2026-03-12T00:00:01.000Z",
          startedAt: "2026-03-12T00:00:02.000Z",
          completedAt: "2026-03-12T00:00:04.000Z",
          durationMs: 2000,
          attempts: 2,
          lastError: "temporary timeout",
        },
      ],
      metrics: {
        averageDurationMs: 2500,
        failureRatePercent: 50,
        recoverySuccessRatePercent: 50,
      },
    });

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.analysisHistory).toEqual([
      {
        jobId: "job-1",
        reason: "manual_reanalysis",
        status: "failed",
        queuedAt: "2026-03-12T00:00:01.000Z",
        startedAt: "2026-03-12T00:00:02.000Z",
        completedAt: "2026-03-12T00:00:04.000Z",
        durationMs: 2000,
        attempts: 2,
        lastError: "temporary timeout",
      },
    ]);
    expect(dto.dogfoodingMetrics).toEqual({
      averageDurationMs: 2500,
      failureRatePercent: 50,
      recoverySuccessRatePercent: 50,
    });
  });
});
