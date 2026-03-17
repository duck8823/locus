import { randomUUID } from "node:crypto";
import type { Sql } from "./types";
import type {
  ActiveAnalysisJobSnapshot,
  AnalysisJobScheduler,
  AnalysisJobHistorySnapshot,
  FindQueuedAnalysisJobInput,
  QueuedAnalysisJobSnapshot,
  ScheduleAnalysisJobInput,
  ScheduledAnalysisJob,
} from "@/server/application/ports/analysis-job-scheduler";
import { DEFAULT_ANALYSIS_JOB_STALE_RUNNING_MS } from "@/server/application/constants/analysis-job-queue-policy";
import { classifyIntegrationFailure } from "@/server/application/services/classify-integration-failure";

interface AnalysisJobRow {
  job_id: string;
  review_id: string;
  requested_at: string;
  reason: ScheduleAnalysisJobInput["reason"];
  status: "queued" | "running" | "succeeded" | "failed";
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  attempts: number;
  last_error: string | null;
}

export interface QueuedAnalysisJob {
  jobId: string;
  reviewId: string;
  requestedAt: string;
  reason: ScheduleAnalysisJobInput["reason"];
  queuedAt: string;
  attempt: number;
}

export interface PgAnalysisJobSchedulerOptions {
  maxAttempts?: number;
  maxRetainedTerminalJobs?: number;
  staleRunningMs?: number;
  autoRun?: boolean;
  onJob: (job: QueuedAnalysisJob) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_RETAINED_TERMINAL_JOBS = 500;
const DEFAULT_HISTORY_LIMIT = 20;

function normalizeMinimumOneInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return fallback;
  }

  return value;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fallback;
  }

  return value;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown analysis job error";
}

export class PgAnalysisJobScheduler implements AnalysisJobScheduler {
  private readonly maxAttempts: number;
  private readonly maxRetainedTerminalJobs: number;
  private readonly staleRunningMs: number;
  private readonly autoRun: boolean;
  private readonly onJob: (job: QueuedAnalysisJob) => Promise<void>;
  private drainPromise: Promise<void> | null = null;

  constructor(
    private readonly sql: Sql,
    options: PgAnalysisJobSchedulerOptions,
  ) {
    this.maxAttempts = normalizeMinimumOneInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    this.maxRetainedTerminalJobs = normalizeNonNegativeInteger(
      options.maxRetainedTerminalJobs,
      DEFAULT_MAX_RETAINED_TERMINAL_JOBS,
    );
    this.staleRunningMs = normalizeMinimumOneInteger(
      options.staleRunningMs,
      DEFAULT_ANALYSIS_JOB_STALE_RUNNING_MS,
    );
    this.autoRun = options.autoRun ?? true;
    this.onJob = options.onJob;

    if (this.autoRun) {
      this.scheduleDrain();
    }
  }

  async scheduleReviewAnalysis(input: ScheduleAnalysisJobInput): Promise<ScheduledAnalysisJob> {
    const acceptedAt = new Date().toISOString();

    // Recover stale running jobs
    await this.recoverStaleRunningJobs(acceptedAt);

    // Check for existing pending job
    const pendingJobs = await this.sql<AnalysisJobRow[]>`
      SELECT job_id, requested_at, reason, queued_at
      FROM analysis_jobs
      WHERE review_id = ${input.reviewId}
        AND reason = ${input.reason}
        AND status = 'queued'
        AND attempts = 0
      ORDER BY queued_at ASC
      LIMIT 1
    `;

    if (pendingJobs.length > 0) {
      const pendingJob = pendingJobs[0];
      const latestRequestedAt =
        input.requestedAt > pendingJob.requested_at
          ? input.requestedAt
          : pendingJob.requested_at;

      await this.sql`
        UPDATE analysis_jobs
        SET requested_at = ${latestRequestedAt}
        WHERE job_id = ${pendingJob.job_id}
      `;

      if (this.autoRun) {
        this.scheduleDrain();
      }

      return {
        jobId: pendingJob.job_id,
        acceptedAt: pendingJob.queued_at,
        reason: pendingJob.reason,
      };
    }

    // Create new job
    const jobId = randomUUID();

    await this.sql`
      INSERT INTO analysis_jobs (job_id, review_id, requested_at, reason, status, queued_at, attempts)
      VALUES (${jobId}, ${input.reviewId}, ${input.requestedAt}, ${input.reason}, 'queued', ${acceptedAt}, 0)
    `;

    if (this.autoRun) {
      this.scheduleDrain();
    }

    return { jobId, acceptedAt, reason: input.reason };
  }

  async findQueuedJob(
    input: FindQueuedAnalysisJobInput,
  ): Promise<QueuedAnalysisJobSnapshot | null> {
    const rows = await this.sql<AnalysisJobRow[]>`
      SELECT job_id, review_id, requested_at, reason, queued_at
      FROM analysis_jobs
      WHERE review_id = ${input.reviewId}
        AND reason = ${input.reason}
        AND status = 'queued'
      ORDER BY queued_at ASC
      LIMIT 1
    `;

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];

    return {
      jobId: row.job_id,
      reviewId: row.review_id,
      requestedAt: row.requested_at,
      reason: row.reason,
      queuedAt: row.queued_at,
    };
  }

  async findActiveJob(
    input: FindQueuedAnalysisJobInput,
  ): Promise<ActiveAnalysisJobSnapshot | null> {
    const nowEpochMs = Date.now();
    const staleThreshold = new Date(nowEpochMs - this.staleRunningMs).toISOString();

    // Check for running (non-stale) jobs first
    const runningJobs = await this.sql<AnalysisJobRow[]>`
      SELECT job_id, review_id, requested_at, reason, status, queued_at, started_at
      FROM analysis_jobs
      WHERE review_id = ${input.reviewId}
        AND reason = ${input.reason}
        AND status = 'running'
        AND (started_at IS NULL OR started_at > ${staleThreshold})
      ORDER BY COALESCE(started_at, queued_at) DESC
      LIMIT 1
    `;

    if (runningJobs.length > 0) {
      const row = runningJobs[0];

      return {
        jobId: row.job_id,
        reviewId: row.review_id,
        requestedAt: row.requested_at,
        reason: row.reason,
        status: "running",
        queuedAt: row.queued_at,
        startedAt: row.started_at,
      };
    }

    // Check for queued jobs
    const queuedJobs = await this.sql<AnalysisJobRow[]>`
      SELECT job_id, review_id, requested_at, reason, status, queued_at, started_at
      FROM analysis_jobs
      WHERE review_id = ${input.reviewId}
        AND reason = ${input.reason}
        AND status = 'queued'
      ORDER BY queued_at ASC
      LIMIT 1
    `;

    if (queuedJobs.length === 0) {
      return null;
    }

    const row = queuedJobs[0];

    return {
      jobId: row.job_id,
      reviewId: row.review_id,
      requestedAt: row.requested_at,
      reason: row.reason,
      status: "queued",
      queuedAt: row.queued_at,
      startedAt: row.started_at,
    };
  }

  async listRecentJobs(input: {
    reviewId: string;
    limit?: number;
  }): Promise<AnalysisJobHistorySnapshot[]> {
    const limit = normalizeMinimumOneInteger(input.limit, DEFAULT_HISTORY_LIMIT);

    const rows = await this.sql<AnalysisJobRow[]>`
      SELECT job_id, review_id, requested_at, reason, status,
             queued_at, started_at, completed_at, duration_ms, attempts, last_error
      FROM analysis_jobs
      WHERE review_id = ${input.reviewId}
      ORDER BY queued_at DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      jobId: row.job_id,
      reviewId: row.review_id,
      requestedAt: row.requested_at,
      reason: row.reason,
      status: row.status,
      queuedAt: row.queued_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      attempts: row.attempts,
      lastError: row.last_error,
    }));
  }

  async drainNow(): Promise<void> {
    await this.drain();
  }

  private scheduleDrain(): void {
    if (this.drainPromise) {
      return;
    }

    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
    });
  }

  private async drain(): Promise<void> {
    while (true) {
      const claimed = await this.claimNextJob();

      if (!claimed) {
        return;
      }

      try {
        await this.onJob(claimed.job);
        await this.markJobSucceeded(claimed.jobId, claimed.startedAt);
      } catch (error) {
        await this.markJobFailedOrRetry(claimed.jobId, claimed.startedAt, error);
      }
    }
  }

  private async claimNextJob(): Promise<{
    jobId: string;
    startedAt: string;
    job: QueuedAnalysisJob;
  } | null> {
    const now = new Date().toISOString();

    await this.recoverStaleRunningJobs(now);

    const rows = await this.sql<AnalysisJobRow[]>`
      UPDATE analysis_jobs
      SET status = 'running',
          started_at = ${now},
          completed_at = NULL,
          duration_ms = NULL,
          attempts = attempts + 1
      WHERE job_id = (
        SELECT job_id FROM analysis_jobs
        WHERE status = 'queued'
        ORDER BY queued_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING job_id, review_id, requested_at, reason, queued_at, attempts
    `;

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];

    return {
      jobId: row.job_id,
      startedAt: now,
      job: {
        jobId: row.job_id,
        reviewId: row.review_id,
        requestedAt: row.requested_at,
        reason: row.reason,
        queuedAt: row.queued_at,
        attempt: row.attempts,
      },
    };
  }

  private async recoverStaleRunningJobs(now: string): Promise<void> {
    const staleThreshold = new Date(Date.parse(now) - this.staleRunningMs).toISOString();

    await this.sql`
      UPDATE analysis_jobs
      SET status = 'queued', started_at = NULL, completed_at = NULL, duration_ms = NULL
      WHERE status = 'running'
        AND started_at IS NOT NULL
        AND started_at <= ${staleThreshold}
    `;
  }

  private async markJobSucceeded(jobId: string, startedAt: string): Promise<void> {
    const completedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));

    await this.sql`
      UPDATE analysis_jobs
      SET status = 'succeeded', completed_at = ${completedAt},
          duration_ms = ${durationMs}, last_error = NULL
      WHERE job_id = ${jobId}
    `;

    await this.pruneTerminalJobs();
  }

  private async markJobFailedOrRetry(
    jobId: string,
    startedAt: string,
    error: unknown,
  ): Promise<void> {
    const completedAt = new Date().toISOString();
    const errorMessage = toErrorMessage(error);
    const failure = classifyIntegrationFailure(error);
    const diagnosticErrorMessage = `${failure.reasonCode}: ${errorMessage}`;
    const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));

    const rows = await this.sql<AnalysisJobRow[]>`
      SELECT attempts FROM analysis_jobs WHERE job_id = ${jobId}
    `;

    if (rows.length === 0) {
      return;
    }

    const shouldRetry = failure.retryable && rows[0].attempts < this.maxAttempts;

    if (!shouldRetry) {
      await this.sql`
        UPDATE analysis_jobs
        SET status = 'failed', completed_at = ${completedAt},
            duration_ms = ${durationMs}, last_error = ${diagnosticErrorMessage}
        WHERE job_id = ${jobId}
      `;
      console.warn("analysis_job_failed", {
        jobId,
        attempts: rows[0].attempts,
        maxAttempts: this.maxAttempts,
        retryable: failure.retryable,
        failureClass: failure.failureClass,
        reasonCode: failure.reasonCode,
        message: errorMessage,
      });
    } else {
      await this.sql`
        UPDATE analysis_jobs
        SET status = 'queued', started_at = NULL, completed_at = ${completedAt},
            duration_ms = ${durationMs}, last_error = ${diagnosticErrorMessage},
            queued_at = ${completedAt}
        WHERE job_id = ${jobId}
      `;
      console.warn("analysis_job_retry_scheduled", {
        jobId,
        attempts: rows[0].attempts,
        maxAttempts: this.maxAttempts,
        retryable: failure.retryable,
        failureClass: failure.failureClass,
        reasonCode: failure.reasonCode,
        message: errorMessage,
      });
    }

    await this.pruneTerminalJobs();
  }

  private async pruneTerminalJobs(): Promise<void> {
    if (this.maxRetainedTerminalJobs < 0) {
      return;
    }

    await this.sql`
      DELETE FROM analysis_jobs
      WHERE job_id IN (
        SELECT job_id FROM analysis_jobs
        WHERE status IN ('succeeded', 'failed')
        ORDER BY COALESCE(completed_at, queued_at) DESC
        OFFSET ${this.maxRetainedTerminalJobs}
      )
    `;
  }
}
