import { beforeEach, describe, expect, it, vi } from "vitest";
import { LiveBusinessContextUnavailableError } from "@/server/application/errors/live-business-context-unavailable-error";
import {
  createMixedContextFallbackSnapshotFixture,
  createMixedContextLiveSnapshotFixture,
} from "@/server/application/testing/mixed-context-fixtures";

const {
  getDependenciesMock,
  executeMock,
  toReviewWorkspaceDtoMock,
  loadActiveInitialAnalysisJobMock,
  loadActiveManualReanalysisJobMock,
  loadAnalysisJobHistoryMock,
  resolveEffectiveReanalysisStateMock,
  generateSuggestionsMock,
} = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  executeMock: vi.fn(),
  toReviewWorkspaceDtoMock: vi.fn(),
  loadActiveInitialAnalysisJobMock: vi.fn(),
  loadActiveManualReanalysisJobMock: vi.fn(),
  loadAnalysisJobHistoryMock: vi.fn(),
  resolveEffectiveReanalysisStateMock: vi.fn(),
  generateSuggestionsMock: vi.fn(),
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

function createWorkspaceShellDto() {
  return {
    reviewId: "review-mixed-context",
    title: "Mixed context review",
    repositoryName: "octocat/locus",
    branchLabel: "feature/mixed-context",
    viewerName: "demo-reviewer",
    analysisStatus: "ready" as const,
    analysisRequestedAt: null,
    analysisCompletedAt: null,
    analysisTotalFiles: null,
    analysisProcessedFiles: null,
    analysisSupportedFiles: null,
    analysisUnsupportedFiles: 0,
    analysisCoveragePercent: null,
    analysisAttemptCount: 0,
    analysisDurationMs: null,
    analysisError: null,
    activeAnalysisJob: null,
    analysisHistory: [],
    dogfoodingMetrics: {
      averageDurationMs: null,
      failureRatePercent: null,
      recoverySuccessRatePercent: null,
    },
    queueHealth: null,
    aiSuggestionPayload: null,
    aiSuggestionAudit: null,
    aiSuggestions: [],
    reanalysisStatus: "idle" as const,
    lastOpenedAt: "2026-03-15T00:00:00.000Z",
    lastReanalyzeRequestedAt: null,
    lastReanalyzeCompletedAt: null,
    lastReanalyzeError: null,
    availableStatuses: ["unread", "in_progress", "reviewed"] as const,
    unsupportedSummary: {
      totalCount: 0,
      byReason: [],
      sampleFilePaths: [],
    },
    unsupportedFiles: [],
    businessContext: {
      generatedAt: "2026-03-15T00:00:00.000Z",
      provider: "stub" as const,
      diagnostics: {
        status: "ok" as const,
        retryable: true,
        reasonCode: null,
        message: null,
        occurredAt: null,
        cacheHit: null,
        fallbackReason: null,
        conflictReasonCodes: [],
      },
      items: [],
    },
    groups: [],
  };
}

describe("loadReviewWorkspaceDto (mixed context fixtures)", () => {
  beforeEach(() => {
    getDependenciesMock.mockReset();
    executeMock.mockReset();
    toReviewWorkspaceDtoMock.mockReset();
    loadActiveInitialAnalysisJobMock.mockReset();
    loadActiveManualReanalysisJobMock.mockReset();
    loadAnalysisJobHistoryMock.mockReset();
    resolveEffectiveReanalysisStateMock.mockReset();
    generateSuggestionsMock.mockReset();

    loadActiveInitialAnalysisJobMock.mockResolvedValue(null);
    loadActiveManualReanalysisJobMock.mockResolvedValue(null);
    loadAnalysisJobHistoryMock.mockResolvedValue({
      history: [],
      metrics: {
        averageDurationMs: null,
        failureRatePercent: null,
        recoverySuccessRatePercent: null,
      },
      queueHealth: {
        status: "healthy",
        queuedJobs: 0,
        runningJobs: 0,
        staleRunningJobs: 0,
        failedTerminalJobs: 0,
        lastFailedJob: null,
        diagnostics: {
          staleRunningThresholdMs: 600000,
          reasonCodes: [],
        },
      },
    });
    resolveEffectiveReanalysisStateMock.mockReturnValue({
      reanalysisStatus: "idle",
      lastReanalyzeRequestedAt: null,
    });
    generateSuggestionsMock.mockResolvedValue([]);
    executeMock.mockResolvedValue({
      id: "review-session",
      toRecord: () => ({
        reviewId: "review-mixed-context",
        repositoryName: "octocat/locus",
        branchLabel: "feature/mixed-context",
        title: "Mixed context review",
        viewerName: "demo-reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 321,
        },
      }),
    });
    toReviewWorkspaceDtoMock.mockReturnValue(createWorkspaceShellDto());
  });

  it("keeps diagnostics parity for mixed live snapshots", async () => {
    const mixedLiveSnapshot = createMixedContextLiveSnapshotFixture();
    const loadSnapshotForReviewMock = vi.fn().mockResolvedValue(mixedLiveSnapshot);
    getDependenciesMock.mockReturnValue({
      reviewSessionRepository: {},
      analysisJobScheduler: {},
      connectionTokenRepository: {
        findTokenByReviewerId: vi.fn().mockResolvedValue({
          reviewerId: "demo-reviewer",
          provider: "github",
          accessToken: "oauth-access-token",
          tokenType: "bearer",
          scope: "repo read:org",
          refreshToken: null,
          expiresAt: null,
          updatedAt: "2026-03-15T00:00:00.000Z",
        }),
      },
      businessContextProvider: {
        loadSnapshotForReview: loadSnapshotForReviewMock,
      },
      aiSuggestionProvider: {
        generateSuggestions: generateSuggestionsMock,
      },
      aiSuggestionAuditProfile: {
        requestedMode: "heuristic",
        provider: "heuristic",
        fallbackProvider: "heuristic",
        promptTemplateId: "heuristic.rule_set.v1",
        promptVersion: "heuristic.v1",
      },
    });

    const dto = await loadReviewWorkspaceDto({
      reviewId: "review-mixed-context",
    });

    expect(dto.businessContext.provider).toBe("github_live");
    expect(dto.businessContext.generatedAt).toBe("2026-03-15T00:00:00.000Z");
    expect(dto.businessContext.diagnostics).toEqual({
      status: "ok",
      retryable: true,
      reasonCode: null,
      message: null,
      occurredAt: null,
      cacheHit: false,
      fallbackReason: null,
      conflictReasonCodes: ["freshness_priority", "provider_priority"],
    });
    expect(dto.businessContext.items).toEqual(mixedLiveSnapshot.items);
  });

  it("keeps workspace rendering on mixed-provider partial outage using fallback snapshot", async () => {
    const fallbackSnapshot = createMixedContextFallbackSnapshotFixture();
    getDependenciesMock.mockReturnValue({
      reviewSessionRepository: {},
      analysisJobScheduler: {},
      connectionTokenRepository: {
        findTokenByReviewerId: vi.fn().mockResolvedValue({
          reviewerId: "demo-reviewer",
          provider: "github",
          accessToken: "oauth-access-token",
          tokenType: "bearer",
          scope: "repo read:org",
          refreshToken: null,
          expiresAt: null,
          updatedAt: "2026-03-15T00:00:00.000Z",
        }),
      },
      businessContextProvider: {
        loadSnapshotForReview: vi.fn().mockRejectedValue(
          new LiveBusinessContextUnavailableError({
            message: "Live business-context fetch failed: mixed provider timeout",
            fallbackSnapshot,
            cacheHit: true,
            fallbackReason: "stale_cache",
            retryable: true,
            reasonCode: "timeout",
          }),
        ),
      },
      aiSuggestionProvider: {
        generateSuggestions: generateSuggestionsMock,
      },
      aiSuggestionAuditProfile: {
        requestedMode: "heuristic",
        provider: "heuristic",
        fallbackProvider: "heuristic",
        promptTemplateId: "heuristic.rule_set.v1",
        promptVersion: "heuristic.v1",
      },
    });

    const dto = await loadReviewWorkspaceDto({
      reviewId: "review-mixed-context",
    });

    expect(dto.businessContext.provider).toBe("fallback");
    expect(dto.businessContext.diagnostics.status).toBe("fallback");
    expect(dto.businessContext.diagnostics.retryable).toBe(true);
    expect(dto.businessContext.diagnostics.reasonCode).toBe("timeout");
    expect(dto.businessContext.diagnostics.cacheHit).toBe(true);
    expect(dto.businessContext.diagnostics.fallbackReason).toBe("stale_cache");
    expect(dto.businessContext.diagnostics.conflictReasonCodes).toEqual(["confidence_priority"]);
    expect(dto.businessContext.items).toEqual(fallbackSnapshot.items);
  });
});
