import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type {
  AnalysisJobScheduler,
  FindQueuedAnalysisJobInput,
  QueuedAnalysisJobSnapshot,
  ScheduleAnalysisJobInput,
  ScheduledAnalysisJob,
} from "@/server/application/ports/analysis-job-scheduler";

interface PersistedAnalysisJobRecord {
  jobId: string;
  reviewId: string;
  requestedAt: string;
  reason: ScheduleAnalysisJobInput["reason"];
  status: "queued" | "running" | "succeeded" | "failed";
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempts: number;
  lastError: string | null;
}

interface QueueStore {
  jobs: PersistedAnalysisJobRecord[];
}

export interface QueuedAnalysisJob {
  jobId: string;
  reviewId: string;
  requestedAt: string;
  reason: ScheduleAnalysisJobInput["reason"];
  queuedAt: string;
  attempt: number;
}

export interface FileAnalysisJobSchedulerOptions {
  dataDirectory?: string;
  maxAttempts?: number;
  maxRetainedTerminalJobs?: number;
  staleRunningMs?: number;
  autoRun?: boolean;
  onJob: (job: QueuedAnalysisJob) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_RETAINED_TERMINAL_JOBS = 500;
const DEFAULT_STALE_RUNNING_MS = 10 * 60 * 1000;

function normalizeMinimumOneInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return fallback;
  }

  if (value < 1) {
    return fallback;
  }

  return value;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return fallback;
  }

  if (value < 0) {
    return fallback;
  }

  return value;
}

function selectLatestRequestedAt(current: string, next: string): string {
  const currentEpochMs = Date.parse(current);
  const nextEpochMs = Date.parse(next);

  if (Number.isNaN(currentEpochMs) || Number.isNaN(nextEpochMs)) {
    return next;
  }

  return nextEpochMs >= currentEpochMs ? next : current;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown analysis job error";
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export class FileAnalysisJobScheduler implements AnalysisJobScheduler {
  private readonly filePath: string;
  private readonly maxAttempts: number;
  private readonly maxRetainedTerminalJobs: number;
  private readonly staleRunningMs: number;
  private readonly autoRun: boolean;
  private readonly onJob: (job: QueuedAnalysisJob) => Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private drainPromise: Promise<void> | null = null;

  constructor(options: FileAnalysisJobSchedulerOptions) {
    this.filePath =
      options.dataDirectory ??
      path.join(process.cwd(), ".locus-data", "analysis-jobs", "jobs.json");
    this.maxAttempts = normalizeMinimumOneInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    this.maxRetainedTerminalJobs = normalizeNonNegativeInteger(
      options.maxRetainedTerminalJobs,
      DEFAULT_MAX_RETAINED_TERMINAL_JOBS,
    );
    this.staleRunningMs = normalizeMinimumOneInteger(
      options.staleRunningMs,
      DEFAULT_STALE_RUNNING_MS,
    );
    this.autoRun = options.autoRun ?? true;
    this.onJob = options.onJob;

    if (this.autoRun) {
      this.scheduleDrain();
    }
  }

  async scheduleReviewAnalysis(input: ScheduleAnalysisJobInput): Promise<ScheduledAnalysisJob> {
    const acceptedAt = new Date().toISOString();
    const scheduledJob = await this.mutateStore((store) => {
      this.recoverStaleRunningJobs(store.jobs, acceptedAt);
      const pendingJob = [...store.jobs]
        .filter(
          (job) =>
            job.reviewId === input.reviewId &&
            job.reason === input.reason &&
            job.status === "queued" &&
            job.attempts === 0,
        )
        .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))[0];

      if (pendingJob) {
        pendingJob.requestedAt = selectLatestRequestedAt(
          pendingJob.requestedAt,
          input.requestedAt,
        );
        return {
          jobId: pendingJob.jobId,
          acceptedAt: pendingJob.queuedAt,
          reason: pendingJob.reason,
        };
      }

      const record: PersistedAnalysisJobRecord = {
        jobId: randomUUID(),
        reviewId: input.reviewId,
        requestedAt: input.requestedAt,
        reason: input.reason,
        status: "queued",
        queuedAt: acceptedAt,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        attempts: 0,
        lastError: null,
      };

      store.jobs.push(record);

      return {
        jobId: record.jobId,
        acceptedAt,
        reason: record.reason,
      };
    });

    if (this.autoRun) {
      this.scheduleDrain();
    }

    return scheduledJob;
  }

  async findQueuedJob(
    input: FindQueuedAnalysisJobInput,
  ): Promise<QueuedAnalysisJobSnapshot | null> {
    const store = await this.loadStore();
    const queuedJob = [...store.jobs]
      .filter(
        (job) =>
          job.reviewId === input.reviewId &&
          job.reason === input.reason &&
          job.status === "queued",
      )
      .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))[0];

    if (!queuedJob) {
      return null;
    }

    return {
      jobId: queuedJob.jobId,
      reviewId: queuedJob.reviewId,
      requestedAt: queuedJob.requestedAt,
      reason: queuedJob.reason,
      queuedAt: queuedJob.queuedAt,
    };
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

  private async claimNextJob(): Promise<{ jobId: string; startedAt: string; job: QueuedAnalysisJob } | null> {
    return this.mutateStore((store) => {
      const now = new Date().toISOString();
      this.recoverStaleRunningJobs(store.jobs, now);
      const nextJob = [...store.jobs]
        .filter((job) => job.status === "queued")
        .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))[0];

      if (!nextJob) {
        return null;
      }

      const startedAt = now;
      nextJob.status = "running";
      nextJob.startedAt = startedAt;
      nextJob.completedAt = null;
      nextJob.durationMs = null;
      nextJob.attempts += 1;

      return {
        jobId: nextJob.jobId,
        startedAt,
        job: {
          jobId: nextJob.jobId,
          reviewId: nextJob.reviewId,
          requestedAt: nextJob.requestedAt,
          reason: nextJob.reason,
          queuedAt: nextJob.queuedAt,
          attempt: nextJob.attempts,
        },
      };
    });
  }

  private recoverStaleRunningJobs(jobs: PersistedAnalysisJobRecord[], now: string): void {
    const nowEpochMs = Date.parse(now);

    for (const job of jobs) {
      if (job.status !== "running") {
        continue;
      }

      const startedAtEpochMs = Date.parse(job.startedAt ?? "");

      if (Number.isNaN(nowEpochMs) || Number.isNaN(startedAtEpochMs)) {
        job.status = "queued";
        job.startedAt = null;
        job.completedAt = null;
        job.durationMs = null;
        continue;
      }

      if (nowEpochMs - startedAtEpochMs >= this.staleRunningMs) {
        job.status = "queued";
        job.startedAt = null;
        job.completedAt = null;
        job.durationMs = null;
      }
    }
  }

  private async markJobSucceeded(jobId: string, startedAt: string): Promise<void> {
    await this.mutateStore((store) => {
      const job = store.jobs.find((entry) => entry.jobId === jobId);

      if (!job) {
        return;
      }

      const completedAt = new Date().toISOString();
      job.status = "succeeded";
      job.completedAt = completedAt;
      job.durationMs = this.calculateDurationMs(startedAt, completedAt);
      job.lastError = null;
    });
  }

  private async markJobFailedOrRetry(
    jobId: string,
    startedAt: string,
    error: unknown,
  ): Promise<void> {
    await this.mutateStore((store) => {
      const job = store.jobs.find((entry) => entry.jobId === jobId);

      if (!job) {
        return;
      }

      const completedAt = new Date().toISOString();
      const errorMessage = toErrorMessage(error);

      if (job.attempts >= this.maxAttempts) {
        job.status = "failed";
        job.completedAt = completedAt;
        job.durationMs = this.calculateDurationMs(startedAt, completedAt);
        job.lastError = errorMessage;
        return;
      }

      job.status = "queued";
      job.startedAt = null;
      job.completedAt = completedAt;
      job.durationMs = this.calculateDurationMs(startedAt, completedAt);
      job.lastError = errorMessage;
      job.queuedAt = completedAt;
    });
  }

  private calculateDurationMs(startedAt: string, completedAt: string): number | null {
    const startedAtEpochMs = Date.parse(startedAt);
    const completedAtEpochMs = Date.parse(completedAt);

    if (Number.isNaN(startedAtEpochMs) || Number.isNaN(completedAtEpochMs)) {
      return null;
    }

    return Math.max(0, completedAtEpochMs - startedAtEpochMs);
  }

  private pruneTerminalJobs(store: QueueStore): void {
    if (this.maxRetainedTerminalJobs < 0) {
      return;
    }

    const terminalJobs = store.jobs.filter(
      (job) => job.status === "succeeded" || job.status === "failed",
    );

    if (terminalJobs.length <= this.maxRetainedTerminalJobs) {
      return;
    }

    const retainedTerminalJobs = [...terminalJobs]
      .sort((left, right) => {
        const leftEpochMs = Date.parse(left.completedAt ?? left.queuedAt);
        const rightEpochMs = Date.parse(right.completedAt ?? right.queuedAt);
        const normalizedLeftEpochMs = Number.isNaN(leftEpochMs) ? 0 : leftEpochMs;
        const normalizedRightEpochMs = Number.isNaN(rightEpochMs) ? 0 : rightEpochMs;

        return normalizedRightEpochMs - normalizedLeftEpochMs;
      })
      .slice(0, this.maxRetainedTerminalJobs);
    const retainedTerminalJobIds = new Set(retainedTerminalJobs.map((job) => job.jobId));

    store.jobs = store.jobs.filter((job) => {
      if (job.status !== "succeeded" && job.status !== "failed") {
        return true;
      }

      return retainedTerminalJobIds.has(job.jobId);
    });
  }

  private async mutateStore<T>(fn: (store: QueueStore) => T | Promise<T>): Promise<T> {
    const task = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const store = await this.loadStore();
        const result = await fn(store);
        this.pruneTerminalJobs(store);
        await this.persistStore(store);
        return result;
      });

    this.writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async loadStore(): Promise<QueueStore> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<QueueStore>;

      if (!parsed || !Array.isArray(parsed.jobs)) {
        return { jobs: [] };
      }

      return {
        jobs: parsed.jobs.filter((job): job is PersistedAnalysisJobRecord => {
          return !!job && typeof job === "object" && typeof job.jobId === "string";
        }),
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        return { jobs: [] };
      }

      throw error;
    }
  }

  private async persistStore(store: QueueStore): Promise<void> {
    const directoryPath = path.dirname(this.filePath);

    await mkdir(directoryPath, { recursive: true });

    const tempFilePath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tempFilePath, JSON.stringify(store, null, 2), "utf8");
    await rename(tempFilePath, this.filePath);
  }
}
