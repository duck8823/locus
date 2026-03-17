import { FileReviewSessionRepository } from "@/server/infrastructure/db/file-review-session-repository";
import { SqliteConnectionStateRepository } from "@/server/infrastructure/db/sqlite-connection-state-repository";
import { FileConnectionTokenRepository } from "@/server/infrastructure/db/file-connection-token-repository";
import { FileOAuthStateRepository } from "@/server/infrastructure/db/file-oauth-state-repository";
import { PrototypeConnectionProviderCatalog } from "@/server/application/services/connection-catalog";
import { createAiSuggestionProviderBundle } from "@/server/infrastructure/ai/create-ai-suggestion-provider";
import { LiveBusinessContextProvider } from "@/server/infrastructure/context/live-business-context-provider";
import { StubBusinessContextProvider } from "@/server/infrastructure/context/stub-business-context-provider";
import { DefaultProviderAgnosticPullRequestSnapshotProvider } from "@/server/infrastructure/code-host/provider-agnostic-pull-request-snapshot-provider";
import { GitHubIssueContextProvider } from "@/server/infrastructure/github/github-issue-context-provider";
import { GitHubPullRequestSnapshotProvider } from "@/server/infrastructure/github/github-pull-request-snapshot-provider";
import { GitHubOAuthCodeExchangeProvider } from "@/server/infrastructure/github/github-oauth-code-exchange-provider";
import { GitLabPullRequestSnapshotProvider } from "@/server/infrastructure/gitlab/gitlab-pull-request-snapshot-provider";
import { TypeScriptParserAdapter } from "@/server/infrastructure/parser/typescript-parser-adapter";
import { ParserAdapterRegistry } from "@/server/application/services/parser-adapter-registry";
import { RunScheduledAnalysisJobUseCase } from "@/server/application/usecases/run-scheduled-analysis-job";
import { FileAnalysisJobScheduler } from "@/server/infrastructure/queue/file-analysis-job-scheduler";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type {
  ConnectionStateTransitionRepository,
  ConnectionStateTransitionTransactionalRepository,
} from "@/server/domain/repositories/connection-state-transition-repository";
import type { ConnectionTokenRepository } from "@/server/application/ports/connection-token-repository";
import type { OAuthStateRepository } from "@/server/application/ports/oauth-state-repository";
import type { AnalysisJobScheduler } from "@/server/application/ports/analysis-job-scheduler";

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

function readFeatureFlagEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function isPostgresMode(): boolean {
  return !!process.env.DATABASE_URL;
}

function createFileDependencies() {
  const reviewSessionRepository: ReviewSessionRepository = new FileReviewSessionRepository();
  const connectionStateRepository = new SqliteConnectionStateRepository({
    maxTransitionsPerReviewer: readOptionalNonNegativeIntegerEnv(
      "LOCUS_CONNECTION_TRANSITION_MAX_RETAINED",
    ),
  });
  const connectionStateTransitionRepository: ConnectionStateTransitionRepository &
    ConnectionStateTransitionTransactionalRepository = connectionStateRepository;
  const connectionTokenRepository: ConnectionTokenRepository = new FileConnectionTokenRepository();
  const oauthStateRepository: OAuthStateRepository = new FileOAuthStateRepository();

  return {
    reviewSessionRepository,
    connectionStateRepository: connectionStateRepository as ConnectionStateRepository,
    connectionStateTransitionRepository,
    connectionTokenRepository,
    oauthStateRepository,
  };
}

async function createPostgresDependencies() {
  const { getPostgresSql, runMigrations } = await import(
    "@/server/infrastructure/db/postgres/index"
  );
  const { PgReviewSessionRepository } = await import(
    "@/server/infrastructure/db/postgres/pg-review-session-repository"
  );
  const { PgConnectionStateRepository } = await import(
    "@/server/infrastructure/db/postgres/pg-connection-state-repository"
  );
  const { PgConnectionTokenRepository } = await import(
    "@/server/infrastructure/db/postgres/pg-connection-token-repository"
  );
  const { PgOAuthStateRepository } = await import(
    "@/server/infrastructure/db/postgres/pg-oauth-state-repository"
  );

  const sql = getPostgresSql();
  await runMigrations(sql);

  const pgConnectionStateRepository = new PgConnectionStateRepository(sql, {
    maxTransitionsPerReviewer: readOptionalNonNegativeIntegerEnv(
      "LOCUS_CONNECTION_TRANSITION_MAX_RETAINED",
    ),
  });

  const reviewSessionRepository: ReviewSessionRepository = new PgReviewSessionRepository(sql);
  const connectionStateRepository: ConnectionStateRepository = pgConnectionStateRepository;
  const connectionStateTransitionRepository: ConnectionStateTransitionRepository &
    ConnectionStateTransitionTransactionalRepository = pgConnectionStateRepository;
  const connectionTokenRepository: ConnectionTokenRepository = new PgConnectionTokenRepository(sql);
  const oauthStateRepository: OAuthStateRepository = new PgOAuthStateRepository(sql);

  return {
    reviewSessionRepository,
    connectionStateRepository,
    connectionStateTransitionRepository,
    connectionTokenRepository,
    oauthStateRepository,
    sql,
  };
}

let dependenciesPromise: Promise<ReturnType<typeof buildDependencies>> | null = null;

function buildDependencies() {
  const connectionProviderCatalog = new PrototypeConnectionProviderCatalog();
  const oauthCodeExchangeProvider = new GitHubOAuthCodeExchangeProvider();
  const aiSuggestionProviderBundle = createAiSuggestionProviderBundle();
  const aiSuggestionProvider = aiSuggestionProviderBundle.provider;
  const aiSuggestionAuditProfile = aiSuggestionProviderBundle.auditProfile;
  const issueContextProvider = new GitHubIssueContextProvider();
  const businessContextProvider = new LiveBusinessContextProvider({
    issueContextProvider,
    fallbackProvider: new StubBusinessContextProvider(),
  });
  const parserAdapterRegistry = new ParserAdapterRegistry();
  parserAdapterRegistry.register(new TypeScriptParserAdapter());
  const parserAdapters = parserAdapterRegistry.toArray();
  const githubPullRequestSnapshotProvider = new GitHubPullRequestSnapshotProvider();
  const gitlabPullRequestSnapshotProvider = new GitLabPullRequestSnapshotProvider();
  const providerAgnosticPullRequestSnapshotProvider =
    new DefaultProviderAgnosticPullRequestSnapshotProvider({
      githubProvider: githubPullRequestSnapshotProvider,
      gitlabProvider: gitlabPullRequestSnapshotProvider,
      enableGitLabAdapter: readFeatureFlagEnv("LOCUS_ENABLE_GITLAB_ADAPTER"),
    });
  const pullRequestSnapshotProvider = githubPullRequestSnapshotProvider;

  return {
    connectionProviderCatalog,
    oauthCodeExchangeProvider,
    aiSuggestionProvider,
    aiSuggestionAuditProfile,
    issueContextProvider,
    businessContextProvider,
    parserAdapters,
    pullRequestSnapshotProvider,
    providerAgnosticPullRequestSnapshotProvider,
  };
}

async function initializeDependencies() {
  const shared = buildDependencies();

  let dbDeps: Awaited<ReturnType<typeof createFileDependencies | typeof createPostgresDependencies>>;
  let analysisJobScheduler: AnalysisJobScheduler;

  if (isPostgresMode()) {
    const pgDeps = await createPostgresDependencies();
    dbDeps = pgDeps;

    const { PgAnalysisJobScheduler } = await import(
      "@/server/infrastructure/db/postgres/pg-analysis-job-scheduler"
    );

    const runScheduledAnalysisJobUseCase = new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository: pgDeps.reviewSessionRepository,
      connectionStateRepository: pgDeps.connectionStateRepository,
      connectionStateTransitionRepository: pgDeps.connectionStateTransitionRepository,
      connectionTokenRepository: pgDeps.connectionTokenRepository,
      connectionProviderCatalog: shared.connectionProviderCatalog,
      parserAdapters: shared.parserAdapters,
      pullRequestSnapshotProvider: shared.pullRequestSnapshotProvider,
      providerAgnosticPullRequestSnapshotProvider: shared.providerAgnosticPullRequestSnapshotProvider,
    });

    analysisJobScheduler = new PgAnalysisJobScheduler(pgDeps.sql, {
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
  } else {
    dbDeps = createFileDependencies();

    const runScheduledAnalysisJobUseCase = new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository: dbDeps.reviewSessionRepository,
      connectionStateRepository: dbDeps.connectionStateRepository,
      connectionStateTransitionRepository: dbDeps.connectionStateTransitionRepository,
      connectionTokenRepository: dbDeps.connectionTokenRepository,
      connectionProviderCatalog: shared.connectionProviderCatalog,
      parserAdapters: shared.parserAdapters,
      pullRequestSnapshotProvider: shared.pullRequestSnapshotProvider,
      providerAgnosticPullRequestSnapshotProvider: shared.providerAgnosticPullRequestSnapshotProvider,
    });

    analysisJobScheduler = new FileAnalysisJobScheduler({
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
  }

  return {
    reviewSessionRepository: dbDeps.reviewSessionRepository,
    connectionStateRepository: dbDeps.connectionStateRepository,
    connectionStateTransitionRepository: dbDeps.connectionStateTransitionRepository,
    connectionTokenRepository: dbDeps.connectionTokenRepository,
    oauthStateRepository: dbDeps.oauthStateRepository,
    analysisJobScheduler,
    ...shared,
  };
}

// Synchronous dependencies for backward compatibility during the transition.
// When DATABASE_URL is not set, file-backed repositories are instantiated eagerly
// so existing callers of getDependencies() continue to work without await.
const fileDeps = isPostgresMode() ? null : createFileDependencies();
const sharedDeps = buildDependencies();

const fileRunScheduledAnalysisJobUseCase = fileDeps
  ? new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository: fileDeps.reviewSessionRepository,
      connectionStateRepository: fileDeps.connectionStateRepository,
      connectionStateTransitionRepository: fileDeps.connectionStateTransitionRepository,
      connectionTokenRepository: fileDeps.connectionTokenRepository,
      connectionProviderCatalog: sharedDeps.connectionProviderCatalog,
      parserAdapters: sharedDeps.parserAdapters,
      pullRequestSnapshotProvider: sharedDeps.pullRequestSnapshotProvider,
      providerAgnosticPullRequestSnapshotProvider: sharedDeps.providerAgnosticPullRequestSnapshotProvider,
    })
  : null;

const fileAnalysisJobScheduler = fileDeps
  ? new FileAnalysisJobScheduler({
      maxAttempts: readOptionalNonNegativeIntegerEnv("LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS"),
      maxRetainedTerminalJobs: readOptionalNonNegativeIntegerEnv(
        "LOCUS_ANALYSIS_JOB_MAX_RETAINED_TERMINAL_JOBS",
      ),
      staleRunningMs: readOptionalNonNegativeIntegerEnv("LOCUS_ANALYSIS_JOB_STALE_RUNNING_MS"),
      onJob: async (job) => {
        await fileRunScheduledAnalysisJobUseCase!.execute({
          jobId: job.jobId,
          reviewId: job.reviewId,
          requestedAt: job.requestedAt,
          reason: job.reason,
        });
      },
    })
  : null;

/**
 * Returns dependencies synchronously. Works for file-backed mode (no DATABASE_URL).
 * When DATABASE_URL is set, use getDependenciesAsync() instead.
 */
export function getDependencies() {
  if (isPostgresMode()) {
    throw new Error(
      "getDependencies() cannot be used in PostgreSQL mode. Use getDependenciesAsync() instead.",
    );
  }

  return {
    reviewSessionRepository: fileDeps!.reviewSessionRepository,
    connectionStateRepository: fileDeps!.connectionStateRepository,
    connectionProviderCatalog: sharedDeps.connectionProviderCatalog,
    connectionStateTransitionRepository: fileDeps!.connectionStateTransitionRepository,
    connectionTokenRepository: fileDeps!.connectionTokenRepository,
    oauthStateRepository: fileDeps!.oauthStateRepository,
    oauthCodeExchangeProvider: sharedDeps.oauthCodeExchangeProvider,
    businessContextProvider: sharedDeps.businessContextProvider,
    aiSuggestionProvider: sharedDeps.aiSuggestionProvider,
    aiSuggestionAuditProfile: sharedDeps.aiSuggestionAuditProfile,
    issueContextProvider: sharedDeps.issueContextProvider,
    analysisJobScheduler: fileAnalysisJobScheduler!,
    parserAdapters: sharedDeps.parserAdapters,
    pullRequestSnapshotProvider: sharedDeps.pullRequestSnapshotProvider,
    providerAgnosticPullRequestSnapshotProvider: sharedDeps.providerAgnosticPullRequestSnapshotProvider,
  };
}

/**
 * Returns dependencies asynchronously. Works for both file-backed and PostgreSQL modes.
 * PostgreSQL mode runs migrations on first call and caches the result.
 */
export async function getDependenciesAsync() {
  if (!isPostgresMode()) {
    return getDependencies();
  }

  if (!dependenciesPromise) {
    dependenciesPromise = initializeDependencies();
  }

  return dependenciesPromise;
}
