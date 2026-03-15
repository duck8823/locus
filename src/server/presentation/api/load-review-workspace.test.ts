import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { generateAiSuggestionsFromPayload } from "@/server/application/ai/generate-ai-suggestions";
import {
  AiSuggestionProviderPermanentError,
  AiSuggestionProviderTemporaryError,
} from "@/server/application/ports/ai-suggestion-provider";
import { LiveBusinessContextUnavailableError } from "@/server/application/errors/live-business-context-unavailable-error";

describe("loadReviewWorkspaceDto", () => {
  beforeEach(() => {
    getDependenciesMock.mockReset();
    executeMock.mockReset();
    toReviewWorkspaceDtoMock.mockReset();
    loadActiveInitialAnalysisJobMock.mockReset();
    loadActiveManualReanalysisJobMock.mockReset();
    loadAnalysisJobHistoryMock.mockReset();
    resolveEffectiveReanalysisStateMock.mockReset();
    generateSuggestionsMock.mockReset();
    generateSuggestionsMock.mockImplementation(async ({ payload }) =>
      generateAiSuggestionsFromPayload(payload),
    );
    const loadSnapshotForReviewMock = vi.fn().mockResolvedValue({
      generatedAt: "2026-03-12T00:00:00.000Z",
      provider: "stub",
      diagnostics: {
        cacheHit: null,
        fallbackReason: null,
        conflictReasonCodes: [],
      },
      items: [],
    });
    getDependenciesMock.mockReturnValue({
      reviewSessionRepository: {},
      analysisJobScheduler: {},
      connectionTokenRepository: {
        findTokenByReviewerId: vi.fn().mockResolvedValue(null),
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
    executeMock.mockResolvedValue({
      id: "review-session",
      toRecord: () => ({
        reviewId: "review-1",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/123-scope -> main",
        title: "Demo workspace",
        viewerName: "demo-reviewer",
        source: null,
      }),
    });
    toReviewWorkspaceDtoMock.mockReturnValue({
      reviewId: "review-1",
      title: "Demo workspace",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/123-scope -> main",
      groups: [],
      reanalysisStatus: "idle",
      lastReanalyzeRequestedAt: null,
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
      businessContext: {
        generatedAt: "2026-03-12T00:00:00.000Z",
        provider: "stub",
        diagnostics: {
          status: "ok",
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
    });
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
    expect(dto.queueHealth).toEqual({
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
    });
    expect(dto.aiSuggestionPayload).toMatchObject({
      review: {
        reviewId: "review-1",
        title: expect.stringMatching(/^\[redacted:/),
      },
      semanticContext: {
        totalCount: 0,
      },
    });
    expect(dto.aiSuggestionAudit).toMatchObject({
      provider: "heuristic",
      requestedMode: "heuristic",
      fallbackProvider: "heuristic",
      promptTemplateId: "heuristic.rule_set.v1",
      promptVersion: "heuristic.v1",
      redactionPolicyVersion: "ai_suggestion_redaction.v1",
    });
    expect(dto.aiSuggestions[0]).toMatchObject({
      suggestionId: "baseline-manual-review",
      category: "general",
    });
    expect(dto.businessContext).toEqual({
      generatedAt: "2026-03-12T00:00:00.000Z",
      provider: "stub",
      diagnostics: {
        status: "ok",
        retryable: true,
        reasonCode: null,
        message: null,
        occurredAt: null,
        cacheHit: null,
        fallbackReason: null,
        conflictReasonCodes: [],
      },
      items: [],
    });
    expect(
      getDependenciesMock.mock.results[0]?.value.businessContextProvider.loadSnapshotForReview,
    ).toHaveBeenCalledWith({
      reviewerId: "demo-reviewer",
      reviewId: "review-1",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/123-scope -> main",
      title: "Demo workspace",
      githubIssueAccessToken: null,
      githubIssueGrantedScopes: [],
      source: null,
    });
  });

  it("keeps activeAnalysisJob null when scheduler snapshot is unavailable", async () => {
    loadActiveInitialAnalysisJobMock.mockResolvedValue(null);

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.activeAnalysisJob).toBeNull();
  });

  it("passes stale-running threshold from env into analysis history loader", async () => {
    const previous = process.env.LOCUS_ANALYSIS_JOB_STALE_RUNNING_MS;

    try {
      process.env.LOCUS_ANALYSIS_JOB_STALE_RUNNING_MS = "120000";

      await loadReviewWorkspaceDto({ reviewId: "review-1" });

      expect(loadAnalysisJobHistoryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewId: "review-1",
          staleRunningThresholdMs: 120000,
        }),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.LOCUS_ANALYSIS_JOB_STALE_RUNNING_MS;
      } else {
        process.env.LOCUS_ANALYSIS_JOB_STALE_RUNNING_MS = previous;
      }
    }
  });

  it("logs degraded queue-health diagnostics for ops visibility", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    loadAnalysisJobHistoryMock.mockResolvedValueOnce({
      history: [],
      metrics: {
        averageDurationMs: null,
        failureRatePercent: null,
        recoverySuccessRatePercent: null,
      },
      queueHealth: {
        status: "degraded",
        queuedJobs: 2,
        runningJobs: 0,
        staleRunningJobs: 1,
        failedTerminalJobs: 1,
        lastFailedJob: {
          jobId: "job-1",
          reason: "manual_reanalysis",
          completedAt: "2026-03-12T00:00:04.000Z",
          lastError: "temporary timeout",
        },
        diagnostics: {
          staleRunningThresholdMs: 600000,
          reasonCodes: ["queue_backlog", "stale_running_job", "terminal_failure_detected"],
        },
      },
    });

    await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "analysis_queue_health_degraded",
      expect.objectContaining({
        reviewId: "review-1",
        status: "degraded",
        queuedJobs: 2,
        staleRunningJobs: 1,
      }),
    );
    consoleWarnSpy.mockRestore();
  });

  it("maps business-context confidence and inference-source fields", async () => {
    const loadSnapshotForReviewMock = vi.fn().mockResolvedValue({
      generatedAt: "2026-03-12T00:00:00.000Z",
      provider: "stub",
      diagnostics: {
        cacheHit: null,
        fallbackReason: null,
        conflictReasonCodes: [],
      },
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
      connectionTokenRepository: {
        findTokenByReviewerId: vi.fn().mockResolvedValue(null),
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
      reasonCode: null,
      message: null,
      occurredAt: null,
      cacheHit: null,
      fallbackReason: null,
      conflictReasonCodes: [],
    });
  });

  it("injects analysis-history snapshots and derived dogfooding metrics", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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
      queueHealth: {
        status: "degraded",
        queuedJobs: 1,
        runningJobs: 0,
        staleRunningJobs: 0,
        failedTerminalJobs: 1,
        lastFailedJob: {
          jobId: "job-1",
          reason: "manual_reanalysis",
          completedAt: "2026-03-12T00:00:04.000Z",
          lastError: "temporary timeout",
        },
        diagnostics: {
          staleRunningThresholdMs: 600000,
          reasonCodes: ["queue_backlog", "terminal_failure_detected"],
        },
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
    expect(dto.queueHealth).toEqual({
      status: "degraded",
      queuedJobs: 1,
      runningJobs: 0,
      staleRunningJobs: 0,
      failedTerminalJobs: 1,
      lastFailedJob: {
        jobId: "job-1",
        reason: "manual_reanalysis",
        completedAt: "2026-03-12T00:00:04.000Z",
        lastError: "temporary timeout",
      },
      diagnostics: {
        staleRunningThresholdMs: 600000,
        reasonCodes: ["queue_backlog", "terminal_failure_detected"],
      },
    });
    consoleWarnSpy.mockRestore();
  });

  it("falls back to diagnostic business context when provider throws", async () => {
    getDependenciesMock.mockReturnValueOnce({
      reviewSessionRepository: {},
      analysisJobScheduler: {},
      connectionTokenRepository: {
        findTokenByReviewerId: vi.fn().mockResolvedValue(null),
      },
      businessContextProvider: {
        loadSnapshotForReview: vi.fn().mockRejectedValue(new Error("context timeout")),
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

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.businessContext.provider).toBe("fallback");
    expect(dto.businessContext.diagnostics.status).toBe("fallback");
    expect(dto.businessContext.diagnostics.retryable).toBe(true);
    expect(dto.businessContext.diagnostics.reasonCode).toBe("timeout");
    expect(dto.businessContext.diagnostics.message).toBe("context timeout");
    expect(dto.businessContext.diagnostics.cacheHit).toBe(false);
    expect(dto.businessContext.diagnostics.fallbackReason).toBe("live_fetch_failed");
    expect(dto.businessContext.diagnostics.conflictReasonCodes).toEqual([]);
    expect(dto.businessContext.items[0]).toMatchObject({
      status: "unavailable",
      sourceType: "github_issue",
      inferenceSource: "none",
    });
  });

  it("preserves stub candidates when live business-context provider returns typed unavailable error", async () => {
    getDependenciesMock.mockReturnValueOnce({
      reviewSessionRepository: {},
      analysisJobScheduler: {},
      connectionTokenRepository: {
        findTokenByReviewerId: vi.fn().mockResolvedValue(null),
      },
      businessContextProvider: {
        loadSnapshotForReview: vi.fn().mockRejectedValue(
          new LiveBusinessContextUnavailableError({
            message: "Live business-context fetch failed: GitHub API timeout",
            fallbackSnapshot: {
              generatedAt: "2026-03-13T00:00:00.000Z",
              provider: "stub",
              diagnostics: {
                cacheHit: null,
                fallbackReason: null,
                conflictReasonCodes: [],
              },
              items: [
                {
                  contextId: "ctx-gh-66",
                  sourceType: "github_issue",
                  status: "candidate",
                  confidence: "medium",
                  inferenceSource: "branch_pattern",
                  title: "Candidate issue: duck8823/locus#66",
                  summary: "Detected from branch naming convention.",
                  href: "https://github.com/duck8823/locus/issues/66",
                },
              ],
            },
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

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.businessContext.provider).toBe("fallback");
    expect(dto.businessContext.diagnostics.status).toBe("fallback");
    expect(dto.businessContext.diagnostics.retryable).toBe(true);
    expect(dto.businessContext.diagnostics.reasonCode).toBe("timeout");
    expect(dto.businessContext.diagnostics.message).toBe(
      "Live business-context fetch failed: GitHub API timeout",
    );
    expect(dto.businessContext.diagnostics.cacheHit).toBe(false);
    expect(dto.businessContext.diagnostics.fallbackReason).toBe("live_fetch_failed");
    expect(dto.businessContext.diagnostics.conflictReasonCodes).toEqual([]);
    expect(dto.businessContext.items).toEqual([
      {
        contextId: "ctx-gh-66",
        sourceType: "github_issue",
        status: "candidate",
        confidence: "medium",
        inferenceSource: "branch_pattern",
        title: "Candidate issue: duck8823/locus#66",
        summary: "Detected from branch naming convention.",
        href: "https://github.com/duck8823/locus/issues/66",
      },
    ]);
  });

  it("maps live-provider business context payloads on workspace load path", async () => {
    getDependenciesMock.mockReturnValueOnce({
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
          updatedAt: "2026-03-13T00:00:00.000Z",
        }),
      },
      businessContextProvider: {
        loadSnapshotForReview: vi.fn().mockResolvedValue({
          generatedAt: "2026-03-13T00:00:00.000Z",
          provider: "github_live",
          diagnostics: {
            cacheHit: false,
            fallbackReason: null,
            conflictReasonCodes: ["provider_priority"],
          },
          items: [
            {
              contextId: "ctx-gh-66",
              sourceType: "github_issue",
              status: "linked",
              confidence: "high",
              inferenceSource: "repo_shorthand",
              title: "Live issue title",
              summary: "Live issue body from GitHub.",
              href: "https://github.com/duck8823/locus/issues/66",
            },
          ],
        }),
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
    executeMock.mockResolvedValueOnce({
      id: "review-session",
      toRecord: () => ({
        reviewId: "review-1",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/66-live-context -> main",
        title: "Live context PR",
        viewerName: "demo-reviewer",
        source: {
          provider: "github",
          owner: "duck8823",
          repository: "locus",
          pullRequestNumber: 66,
        },
      }),
    });

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.businessContext.provider).toBe("github_live");
    expect(dto.businessContext.diagnostics).toEqual({
      status: "ok",
      retryable: true,
      reasonCode: null,
      message: null,
      occurredAt: null,
      cacheHit: false,
      fallbackReason: null,
      conflictReasonCodes: ["provider_priority"],
    });
    expect(dto.businessContext.items[0]).toMatchObject({
      sourceType: "github_issue",
      title: "Live issue title",
      summary: expect.stringContaining("Live issue body"),
      href: "https://github.com/duck8823/locus/issues/66",
    });
  });

  it("returns provider-failure fallback suggestion when provider returns temporary failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    generateSuggestionsMock.mockRejectedValueOnce(
      new AiSuggestionProviderTemporaryError("rate limited"),
    );

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.aiSuggestions[0]).toMatchObject({
      suggestionId: "ai-provider-fallback-manual-review",
      category: "general",
      rationale: expect.arrayContaining(["AI suggestion provider temporary error"]),
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "ai_suggestion_provider_failed",
      expect.objectContaining({
        reviewId: "review-1",
        errorType: "temporary",
        message: "rate limited",
        audit: expect.objectContaining({
          promptVersion: "heuristic.v1",
          redactionPolicyVersion: "ai_suggestion_redaction.v1",
        }),
        payload: expect.objectContaining({
          review: expect.objectContaining({
            title: expect.stringMatching(/^\[redacted:/),
          }),
        }),
      }),
    );
    consoleErrorSpy.mockRestore();
  });

  it("returns provider-failure fallback suggestion when provider returns permanent failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    generateSuggestionsMock.mockRejectedValueOnce(
      new AiSuggestionProviderPermanentError("invalid response schema"),
    );

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.aiSuggestions[0]).toMatchObject({
      suggestionId: "ai-provider-fallback-manual-review",
      category: "general",
      confidence: "low",
      rationale: expect.arrayContaining(["AI suggestion provider permanent error"]),
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "ai_suggestion_provider_failed",
      expect.objectContaining({
        reviewId: "review-1",
        errorType: "permanent",
        message: "invalid response schema",
        audit: expect.objectContaining({
          promptVersion: "heuristic.v1",
          redactionPolicyVersion: "ai_suggestion_redaction.v1",
        }),
        payload: expect.objectContaining({
          review: expect.objectContaining({
            title: expect.stringMatching(/^\[redacted:/),
          }),
        }),
      }),
    );
    consoleErrorSpy.mockRestore();
  });

  it("accepts an empty suggestion response from provider as valid output", async () => {
    generateSuggestionsMock.mockResolvedValueOnce([]);

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(dto.aiSuggestions).toEqual([]);
  });

  it("falls back when GitHub OAuth token scope is insufficient for issue-context fetch", async () => {
    const loadSnapshotForReviewMock = vi.fn();
    getDependenciesMock.mockReturnValueOnce({
      reviewSessionRepository: {},
      analysisJobScheduler: {},
      connectionTokenRepository: {
        findTokenByReviewerId: vi.fn().mockResolvedValue({
          reviewerId: "demo-reviewer",
          provider: "github",
          accessToken: "oauth-access-token",
          tokenType: "bearer",
          scope: "read:org",
          refreshToken: null,
          expiresAt: null,
          updatedAt: "2026-03-13T00:00:00.000Z",
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
    executeMock.mockResolvedValueOnce({
      id: "review-session",
      toRecord: () => ({
        reviewId: "review-1",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/123-scope -> main",
        title: "Demo workspace",
        viewerName: "demo-reviewer",
        source: {
          provider: "github",
          owner: "duck8823",
          repository: "locus",
          pullRequestNumber: 123,
        },
      }),
    });

    const dto = await loadReviewWorkspaceDto({ reviewId: "review-1" });

    expect(loadSnapshotForReviewMock).not.toHaveBeenCalled();
    expect(dto.businessContext.provider).toBe("fallback");
    expect(dto.businessContext.diagnostics.status).toBe("fallback");
    expect(dto.businessContext.diagnostics.retryable).toBe(false);
    expect(dto.businessContext.diagnostics.reasonCode).toBe("auth");
    expect(dto.businessContext.diagnostics.message).toContain("missing issue-read scope");
    expect(dto.businessContext.diagnostics.conflictReasonCodes).toEqual([]);
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
