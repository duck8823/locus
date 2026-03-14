import { FileReviewSessionRepository } from "@/server/infrastructure/db/file-review-session-repository";
import { SqliteConnectionStateRepository } from "@/server/infrastructure/db/sqlite-connection-state-repository";
import { FileConnectionTokenRepository } from "@/server/infrastructure/db/file-connection-token-repository";
import { FileOAuthStateRepository } from "@/server/infrastructure/db/file-oauth-state-repository";
import { PrototypeConnectionProviderCatalog } from "@/server/application/services/connection-catalog";
import { HeuristicAiSuggestionProvider } from "@/server/infrastructure/ai/heuristic-ai-suggestion-provider";
import {
  type AiSuggestionProviderGuardrailPolicy,
  GuardrailedAiSuggestionProvider,
} from "@/server/infrastructure/ai/guardrailed-ai-suggestion-provider";
import { LiveBusinessContextProvider } from "@/server/infrastructure/context/live-business-context-provider";
import { StubBusinessContextProvider } from "@/server/infrastructure/context/stub-business-context-provider";
import { GitHubIssueContextProvider } from "@/server/infrastructure/github/github-issue-context-provider";
import { GitHubPullRequestSnapshotProvider } from "@/server/infrastructure/github/github-pull-request-snapshot-provider";
import { GitHubOAuthCodeExchangeProvider } from "@/server/infrastructure/github/github-oauth-code-exchange-provider";
import { TypeScriptParserAdapter } from "@/server/infrastructure/parser/typescript-parser-adapter";
import { RunScheduledAnalysisJobUseCase } from "@/server/application/usecases/run-scheduled-analysis-job";
import { FileAnalysisJobScheduler } from "@/server/infrastructure/queue/file-analysis-job-scheduler";

function readOptionalNonNegativeIntegerEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();

  if (!value) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function readOptionalPositiveIntegerEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();

  if (!value) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function readOptionalPositiveNumberEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function readAiSuggestionGuardrailPolicy(providerName: string): AiSuggestionProviderGuardrailPolicy {
  const keyPrefix = `LOCUS_AI_SUGGESTION_PROVIDER_${providerName.toUpperCase()}`;

  return {
    timeoutMs: readOptionalPositiveIntegerEnv(`${keyPrefix}_TIMEOUT_MS`) ?? 3000,
    maxEstimatedInputTokens: readOptionalPositiveIntegerEnv(
      `${keyPrefix}_MAX_ESTIMATED_INPUT_TOKENS`,
    ),
    maxEstimatedInputCostUsd: readOptionalPositiveNumberEnv(
      `${keyPrefix}_MAX_ESTIMATED_INPUT_COST_USD`,
    ),
    estimatedInputCostPer1kInputTokensUsd: readOptionalPositiveNumberEnv(
      `${keyPrefix}_ESTIMATED_INPUT_USD_PER_1K_TOKENS`,
    ),
  };
}

const reviewSessionRepository = new FileReviewSessionRepository();
const connectionStateRepository = new SqliteConnectionStateRepository({
  maxTransitionsPerReviewer: readOptionalNonNegativeIntegerEnv(
    "LOCUS_CONNECTION_TRANSITION_MAX_RETAINED",
  ),
});
const connectionStateTransitionRepository = connectionStateRepository;
const connectionProviderCatalog = new PrototypeConnectionProviderCatalog();
const connectionTokenRepository = new FileConnectionTokenRepository();
const oauthStateRepository = new FileOAuthStateRepository();
const oauthCodeExchangeProvider = new GitHubOAuthCodeExchangeProvider();
const heuristicAiSuggestionProvider = new HeuristicAiSuggestionProvider();
const aiSuggestionProvider = new GuardrailedAiSuggestionProvider({
  providerName: "heuristic",
  provider: heuristicAiSuggestionProvider,
  fallbackProviderName: "heuristic",
  fallbackProvider: heuristicAiSuggestionProvider,
  guardrailPolicy: readAiSuggestionGuardrailPolicy("heuristic"),
});
const issueContextProvider = new GitHubIssueContextProvider();
const businessContextProvider = new LiveBusinessContextProvider({
  issueContextProvider,
  fallbackProvider: new StubBusinessContextProvider(),
});
const parserAdapters = [new TypeScriptParserAdapter()];
const pullRequestSnapshotProvider = new GitHubPullRequestSnapshotProvider();
const runScheduledAnalysisJobUseCase = new RunScheduledAnalysisJobUseCase({
  reviewSessionRepository,
  connectionStateRepository,
  connectionStateTransitionRepository,
  connectionTokenRepository,
  connectionProviderCatalog,
  parserAdapters,
  pullRequestSnapshotProvider,
});
const analysisJobScheduler = new FileAnalysisJobScheduler({
  maxAttempts: readOptionalNonNegativeIntegerEnv("LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS"),
  maxRetainedTerminalJobs: readOptionalNonNegativeIntegerEnv(
    "LOCUS_ANALYSIS_JOB_MAX_RETAINED_TERMINAL_JOBS",
  ),
  staleRunningMs: readOptionalNonNegativeIntegerEnv("LOCUS_ANALYSIS_JOB_STALE_RUNNING_MS"),
  onJob: async (job) => {
    await runScheduledAnalysisJobUseCase.execute({
      jobId: job.jobId,
      reviewId: job.reviewId,
      requestedAt: job.requestedAt,
      reason: job.reason,
    });
  },
});

export function getDependencies() {
  return {
    reviewSessionRepository,
    connectionStateRepository,
    connectionProviderCatalog,
    connectionStateTransitionRepository,
    connectionTokenRepository,
    oauthStateRepository,
    oauthCodeExchangeProvider,
    businessContextProvider,
    aiSuggestionProvider,
    issueContextProvider,
    analysisJobScheduler,
    parserAdapters,
    pullRequestSnapshotProvider,
  };
}
