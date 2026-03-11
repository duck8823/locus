import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDependenciesMock,
  executeMock,
  toReviewWorkspaceDtoMock,
  loadActiveInitialAnalysisJobMock,
  loadActiveManualReanalysisJobMock,
  resolveEffectiveReanalysisStateMock,
} = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  executeMock: vi.fn(),
  toReviewWorkspaceDtoMock: vi.fn(),
  loadActiveInitialAnalysisJobMock: vi.fn(),
  loadActiveManualReanalysisJobMock: vi.fn(),
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
      businessContext: {
        generatedAt: "2026-03-12T00:00:00.000Z",
        provider: "stub",
        items: [],
      },
    });
    loadActiveManualReanalysisJobMock.mockResolvedValue(null);
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
    expect(dto.businessContext).toEqual({
      generatedAt: "2026-03-12T00:00:00.000Z",
      provider: "stub",
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
});
