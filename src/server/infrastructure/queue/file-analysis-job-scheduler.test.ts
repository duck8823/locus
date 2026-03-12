import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileAnalysisJobScheduler } from "@/server/infrastructure/queue/file-analysis-job-scheduler";

async function createTempDataDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "locus-analysis-jobs-"));
}

async function readJobsFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function waitFor(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now();

  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out while waiting for condition.");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("FileAnalysisJobScheduler", () => {
  it("drains persisted queued jobs on startup when autoRun is enabled", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const executedJobIds: string[] = [];
    await writeFile(
      filePath,
      JSON.stringify(
        {
          jobs: [
            {
              jobId: "job-queued",
              reviewId: "review-startup",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "initial_ingestion",
              status: "queued",
              queuedAt: "2026-03-10T00:00:00.000Z",
              startedAt: null,
              completedAt: null,
              durationMs: null,
              attempts: 0,
              lastError: null,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: true,
      onJob: async (job) => {
        executedJobIds.push(job.jobId);
      },
    });

    await waitFor(() => executedJobIds.length === 1);
    expect(executedJobIds).toEqual(["job-queued"]);
    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ status: string; attempts: number }>;
    };
    expect(persisted.jobs[0]?.status).toBe("succeeded");
    expect(persisted.jobs[0]?.attempts).toBe(1);
  });

  it("persists and executes queued jobs", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const executedReviewIds: string[] = [];
    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      onJob: async (job) => {
        executedReviewIds.push(job.reviewId);
      },
    });

    const scheduled = await scheduler.scheduleReviewAnalysis({
      reviewId: "review-1",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "initial_ingestion",
    });

    expect(scheduled.reason).toBe("initial_ingestion");
    await scheduler.drainNow();

    expect(executedReviewIds).toEqual(["review-1"]);
    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ status: string; attempts: number }>;
    };
    expect(persisted.jobs).toHaveLength(1);
    expect(persisted.jobs[0]?.status).toBe("succeeded");
    expect(persisted.jobs[0]?.attempts).toBe(1);
  });

  it("reuses an existing pending job for the same review and reason", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      onJob: async () => {},
    });

    const first = await scheduler.scheduleReviewAnalysis({
      reviewId: "review-deduped",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "initial_ingestion",
    });
    const second = await scheduler.scheduleReviewAnalysis({
      reviewId: "review-deduped",
      requestedAt: "2026-03-10T00:01:00.000Z",
      reason: "initial_ingestion",
    });

    expect(second.jobId).toBe(first.jobId);
    expect(second.reason).toBe("initial_ingestion");

    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ reviewId: string; status: string; reason: string; requestedAt: string }>;
    };
    expect(persisted.jobs).toHaveLength(1);
    expect(persisted.jobs[0]?.reviewId).toBe("review-deduped");
    expect(persisted.jobs[0]?.status).toBe("queued");
    expect(persisted.jobs[0]?.reason).toBe("initial_ingestion");
    expect(persisted.jobs[0]?.requestedAt).toBe("2026-03-10T00:01:00.000Z");
  });

  it("keeps the latest requestedAt when a deduped request has an older timestamp", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      onJob: async () => {},
    });

    await scheduler.scheduleReviewAnalysis({
      reviewId: "review-deduped-latest",
      requestedAt: "2026-03-10T00:05:00.000Z",
      reason: "manual_reanalysis",
    });
    await scheduler.scheduleReviewAnalysis({
      reviewId: "review-deduped-latest",
      requestedAt: "2026-03-10T00:04:00.000Z",
      reason: "manual_reanalysis",
    });

    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ reviewId: string; requestedAt: string }>;
    };
    expect(persisted.jobs).toHaveLength(1);
    expect(persisted.jobs[0]?.reviewId).toBe("review-deduped-latest");
    expect(persisted.jobs[0]?.requestedAt).toBe("2026-03-10T00:05:00.000Z");
  });

  it("finds the next queued job for a review and reason", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      onJob: async () => {},
    });

    await scheduler.scheduleReviewAnalysis({
      reviewId: "review-queued-lookup",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "manual_reanalysis",
    });
    await scheduler.scheduleReviewAnalysis({
      reviewId: "review-queued-lookup",
      requestedAt: "2026-03-10T00:00:30.000Z",
      reason: "code_host_webhook",
    });

    const queuedManual = await scheduler.findQueuedJob({
      reviewId: "review-queued-lookup",
      reason: "manual_reanalysis",
    });

    expect(queuedManual).toMatchObject({
      reviewId: "review-queued-lookup",
      reason: "manual_reanalysis",
      requestedAt: "2026-03-10T00:00:00.000Z",
    });
    expect(typeof queuedManual?.jobId).toBe("string");
    expect(typeof queuedManual?.queuedAt).toBe("string");
  });

  it("returns null from queued lookup when no matching queued job exists", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      onJob: async () => {},
    });

    await scheduler.scheduleReviewAnalysis({
      reviewId: "review-no-queued-lookup",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "manual_reanalysis",
    });
    await scheduler.drainNow();

    const queuedManual = await scheduler.findQueuedJob({
      reviewId: "review-no-queued-lookup",
      reason: "manual_reanalysis",
    });

    expect(queuedManual).toBeNull();
  });

  it("returns running job from active lookup when manual reanalysis is already claimed", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const runningQueuedAt = new Date(Date.now() - 5_000).toISOString();
    const runningStartedAt = new Date(Date.now() - 4_000).toISOString();
    const followupQueuedAt = new Date(Date.now() - 1_000).toISOString();
    await writeFile(
      filePath,
      JSON.stringify(
        {
          jobs: [
            {
              jobId: "job-running-manual",
              reviewId: "review-active-lookup",
              requestedAt: runningQueuedAt,
              reason: "manual_reanalysis",
              status: "running",
              queuedAt: runningQueuedAt,
              startedAt: runningStartedAt,
              completedAt: null,
              durationMs: null,
              attempts: 1,
              lastError: null,
            },
            {
              jobId: "job-queued-manual",
              reviewId: "review-active-lookup",
              requestedAt: followupQueuedAt,
              reason: "manual_reanalysis",
              status: "queued",
              queuedAt: followupQueuedAt,
              startedAt: null,
              completedAt: null,
              durationMs: null,
              attempts: 0,
              lastError: null,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      onJob: async () => {},
    });

    const activeJob = await scheduler.findActiveJob({
      reviewId: "review-active-lookup",
      reason: "manual_reanalysis",
    });

    expect(activeJob).toMatchObject({
      jobId: "job-running-manual",
      reviewId: "review-active-lookup",
      requestedAt: runningQueuedAt,
      reason: "manual_reanalysis",
      status: "running",
      startedAt: runningStartedAt,
    });
  });

  it("returns queued job from active lookup when no running job exists", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      onJob: async () => {},
    });

    await scheduler.scheduleReviewAnalysis({
      reviewId: "review-active-queued-only",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "manual_reanalysis",
    });

    const activeJob = await scheduler.findActiveJob({
      reviewId: "review-active-queued-only",
      reason: "manual_reanalysis",
    });

    expect(activeJob).toMatchObject({
      reviewId: "review-active-queued-only",
      reason: "manual_reanalysis",
      status: "queued",
      startedAt: null,
    });
  });

  it("ignores stale running jobs in active lookup", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const staleStartedAt = new Date(Date.now() - 60_000).toISOString();
    await writeFile(
      filePath,
      JSON.stringify(
        {
          jobs: [
            {
              jobId: "job-stale-running-manual",
              reviewId: "review-stale-active-lookup",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "manual_reanalysis",
              status: "running",
              queuedAt: staleStartedAt,
              startedAt: staleStartedAt,
              completedAt: null,
              durationMs: null,
              attempts: 1,
              lastError: null,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      staleRunningMs: 1_000,
      onJob: async () => {},
    });

    const activeJob = await scheduler.findActiveJob({
      reviewId: "review-stale-active-lookup",
      reason: "manual_reanalysis",
    });

    expect(activeJob).toBeNull();
  });

  it("queues a follow-up job when the same review/reason is already running", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const runningStartedAt = new Date().toISOString();
    await writeFile(
      filePath,
      JSON.stringify(
        {
          jobs: [
            {
              jobId: "job-running",
              reviewId: "review-running",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "code_host_webhook",
              status: "running",
              queuedAt: runningStartedAt,
              startedAt: runningStartedAt,
              completedAt: null,
              durationMs: null,
              attempts: 1,
              lastError: null,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      onJob: async () => {},
    });

    const scheduled = await scheduler.scheduleReviewAnalysis({
      reviewId: "review-running",
      requestedAt: "2026-03-10T00:01:00.000Z",
      reason: "code_host_webhook",
    });

    expect(scheduled.jobId).not.toBe("job-running");

    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ jobId: string; reviewId: string; reason: string; status: string }>;
    };
    expect(persisted.jobs).toHaveLength(2);
    expect(
      persisted.jobs.map((job) => `${job.jobId}:${job.reviewId}:${job.reason}:${job.status}`),
    ).toContain("job-running:review-running:code_host_webhook:running");
    expect(
      persisted.jobs.some(
        (job) =>
          job.jobId === scheduled.jobId &&
          job.reviewId === "review-running" &&
          job.reason === "code_host_webhook" &&
          job.status === "queued",
      ),
    ).toBe(true);
  });

  it("queues a new job when existing queued job already consumed retries", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    await writeFile(
      filePath,
      JSON.stringify(
        {
          jobs: [
            {
              jobId: "job-queued-retrying",
              reviewId: "review-queued-retrying",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "code_host_webhook",
              status: "queued",
              queuedAt: "2026-03-10T00:00:30.000Z",
              startedAt: null,
              completedAt: "2026-03-10T00:00:30.000Z",
              durationMs: 1000,
              attempts: 2,
              lastError: "transient",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      maxAttempts: 3,
      onJob: async () => {},
    });

    const scheduled = await scheduler.scheduleReviewAnalysis({
      reviewId: "review-queued-retrying",
      requestedAt: "2026-03-10T00:01:00.000Z",
      reason: "code_host_webhook",
    });

    expect(scheduled.jobId).not.toBe("job-queued-retrying");

    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ jobId: string; reviewId: string; reason: string; status: string; attempts: number }>;
    };
    expect(persisted.jobs).toHaveLength(2);
    expect(
      new Set(persisted.jobs.map((job) => `${job.jobId}:${job.status}:${job.attempts}`)),
    ).toEqual(new Set(["job-queued-retrying:queued:2", `${scheduled.jobId}:queued:0`]));
  });

  it("keeps separate pending jobs when the reason differs", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      onJob: async () => {},
    });

    const first = await scheduler.scheduleReviewAnalysis({
      reviewId: "review-multi-reason",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "code_host_webhook",
    });
    const second = await scheduler.scheduleReviewAnalysis({
      reviewId: "review-multi-reason",
      requestedAt: "2026-03-10T00:01:00.000Z",
      reason: "initial_ingestion",
    });

    expect(second.jobId).not.toBe(first.jobId);

    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ reviewId: string; status: string; reason: string }>;
    };
    expect(persisted.jobs).toHaveLength(2);
    expect(
      persisted.jobs.map((job) => `${job.reviewId}:${job.reason}:${job.status}`).sort(),
    ).toEqual([
      "review-multi-reason:code_host_webhook:queued",
      "review-multi-reason:initial_ingestion:queued",
    ]);
  });

  it("retries failed jobs up to max attempts", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    let attempts = 0;
    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      maxAttempts: 2,
      onJob: async () => {
        attempts += 1;

        if (attempts === 1) {
          throw new Error("transient failure");
        }
      },
    });

    await scheduler.scheduleReviewAnalysis({
      reviewId: "review-2",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "code_host_webhook",
    });

    await scheduler.drainNow();

    expect(attempts).toBe(2);
    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ status: string; attempts: number; lastError: string | null }>;
    };
    expect(persisted.jobs[0]?.status).toBe("succeeded");
    expect(persisted.jobs[0]?.attempts).toBe(2);
    expect(persisted.jobs[0]?.lastError).toBeNull();
  });

  it("recovers stale running jobs and executes them again", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const executedJobIds: string[] = [];
    await writeFile(
      filePath,
      JSON.stringify(
        {
          jobs: [
            {
              jobId: "job-stale",
              reviewId: "review-3",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "manual_reanalysis",
              status: "running",
              queuedAt: "2026-03-10T00:00:00.000Z",
              startedAt: "2000-01-01T00:00:00.000Z",
              completedAt: null,
              durationMs: null,
              attempts: 1,
              lastError: null,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      staleRunningMs: 1,
      onJob: async (job) => {
        executedJobIds.push(job.jobId);
      },
    });

    await scheduler.drainNow();

    expect(executedJobIds).toEqual(["job-stale"]);
    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ status: string; attempts: number }>;
    };
    expect(persisted.jobs[0]?.status).toBe("succeeded");
    expect(persisted.jobs[0]?.attempts).toBe(2);
  });

  it("retains only the latest terminal jobs while keeping queued/running jobs", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const runningStartedAt = new Date().toISOString();
    await writeFile(
      filePath,
      JSON.stringify(
        {
          jobs: [
            {
              jobId: "job-queued-existing",
              reviewId: "review-q",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "manual_reanalysis",
              status: "queued",
              queuedAt: "2026-03-10T00:00:00.000Z",
              startedAt: null,
              completedAt: null,
              durationMs: null,
              attempts: 0,
              lastError: null,
            },
            {
              jobId: "job-running-existing",
              reviewId: "review-r",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "code_host_webhook",
              status: "running",
              queuedAt: runningStartedAt,
              startedAt: runningStartedAt,
              completedAt: null,
              durationMs: null,
              attempts: 1,
              lastError: null,
            },
            {
              jobId: "job-succeeded-oldest",
              reviewId: "review-1",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "initial_ingestion",
              status: "succeeded",
              queuedAt: "2026-03-10T00:00:00.000Z",
              startedAt: "2026-03-10T00:00:00.000Z",
              completedAt: "2026-03-10T00:00:10.000Z",
              durationMs: 10000,
              attempts: 1,
              lastError: null,
            },
            {
              jobId: "job-succeeded-middle",
              reviewId: "review-2",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "initial_ingestion",
              status: "succeeded",
              queuedAt: "2026-03-10T00:00:00.000Z",
              startedAt: "2026-03-10T00:00:00.000Z",
              completedAt: "2026-03-10T00:00:20.000Z",
              durationMs: 20000,
              attempts: 1,
              lastError: null,
            },
            {
              jobId: "job-failed-latest",
              reviewId: "review-3",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "initial_ingestion",
              status: "failed",
              queuedAt: "2026-03-10T00:00:00.000Z",
              startedAt: "2026-03-10T00:00:00.000Z",
              completedAt: "2026-03-10T00:00:30.000Z",
              durationMs: 30000,
              attempts: 3,
              lastError: "failure",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      maxRetainedTerminalJobs: 2,
      onJob: async () => {},
    });

    await scheduler.scheduleReviewAnalysis({
      reviewId: "review-new",
      requestedAt: "2026-03-10T00:05:00.000Z",
      reason: "initial_ingestion",
    });

    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ jobId: string; status: string }>;
    };
    const persistedIds = persisted.jobs.map((job) => job.jobId);

    expect(persistedIds).toContain("job-queued-existing");
    expect(persistedIds).toContain("job-running-existing");
    expect(persistedIds).toContain("job-succeeded-middle");
    expect(persistedIds).toContain("job-failed-latest");
    expect(persistedIds).not.toContain("job-succeeded-oldest");
    expect(persisted.jobs.filter((job) => job.status === "queued")).toHaveLength(2);
  });

  it("falls back to default maxAttempts when an invalid value is provided", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    let attempts = 0;
    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      maxAttempts: 0,
      onJob: async () => {
        attempts += 1;
        throw new Error("always fails");
      },
    });

    await scheduler.scheduleReviewAnalysis({
      reviewId: "review-invalid-max-attempts",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "manual_reanalysis",
    });

    await scheduler.drainNow();

    expect(attempts).toBe(3);
    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ status: string; attempts: number }>;
    };
    expect(persisted.jobs[0]?.status).toBe("failed");
    expect(persisted.jobs[0]?.attempts).toBe(3);
  });

  it("falls back to default maxAttempts when a fractional value is provided", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    let attempts = 0;
    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      maxAttempts: 1.9,
      onJob: async () => {
        attempts += 1;
        throw new Error("always fails");
      },
    });

    await scheduler.scheduleReviewAnalysis({
      reviewId: "review-fractional-max-attempts",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "manual_reanalysis",
    });

    await scheduler.drainNow();

    expect(attempts).toBe(3);
    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ status: string; attempts: number }>;
    };
    expect(persisted.jobs[0]?.status).toBe("failed");
    expect(persisted.jobs[0]?.attempts).toBe(3);
  });

  it("falls back to default staleRunningMs when an invalid value is provided", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    const executedJobIds: string[] = [];
    const now = new Date().toISOString();
    await writeFile(
      filePath,
      JSON.stringify(
        {
          jobs: [
            {
              jobId: "job-running-fresh",
              reviewId: "review-fresh",
              requestedAt: now,
              reason: "manual_reanalysis",
              status: "running",
              queuedAt: now,
              startedAt: now,
              completedAt: null,
              durationMs: null,
              attempts: 1,
              lastError: null,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      staleRunningMs: 0,
      onJob: async (job) => {
        executedJobIds.push(job.jobId);
      },
    });

    await scheduler.drainNow();

    expect(executedJobIds).toEqual([]);
    const persisted = (await readJobsFile(filePath)) as {
      jobs: Array<{ status: string; startedAt: string | null }>;
    };
    expect(persisted.jobs[0]?.status).toBe("running");
    expect(persisted.jobs[0]?.startedAt).toBe(now);
  });

  it("lists recent jobs for a review with status and attempt metadata", async () => {
    const dataDirectory = await createTempDataDirectory();
    const filePath = path.join(dataDirectory, "jobs.json");
    await writeFile(
      filePath,
      JSON.stringify(
        {
          jobs: [
            {
              jobId: "job-old",
              reviewId: "review-history",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "initial_ingestion",
              status: "succeeded",
              queuedAt: "2026-03-10T00:00:01.000Z",
              startedAt: "2026-03-10T00:00:02.000Z",
              completedAt: "2026-03-10T00:00:10.000Z",
              durationMs: 8000,
              attempts: 1,
              lastError: null,
            },
            {
              jobId: "job-other-review",
              reviewId: "review-other",
              requestedAt: "2026-03-10T00:00:00.000Z",
              reason: "manual_reanalysis",
              status: "failed",
              queuedAt: "2026-03-10T00:01:00.000Z",
              startedAt: "2026-03-10T00:01:01.000Z",
              completedAt: "2026-03-10T00:01:04.000Z",
              durationMs: 3000,
              attempts: 2,
              lastError: "network timeout",
            },
            {
              jobId: "job-new",
              reviewId: "review-history",
              requestedAt: "2026-03-10T00:02:00.000Z",
              reason: "manual_reanalysis",
              status: "failed",
              queuedAt: "2026-03-10T00:02:01.000Z",
              startedAt: "2026-03-10T00:02:02.000Z",
              completedAt: "2026-03-10T00:02:05.000Z",
              durationMs: 3000,
              attempts: 3,
              lastError: "temporary failure",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const scheduler = new FileAnalysisJobScheduler({
      dataDirectory: filePath,
      autoRun: false,
      onJob: async () => {},
    });

    const history = await scheduler.listRecentJobs({
      reviewId: "review-history",
      limit: 1,
    });

    expect(history).toEqual([
      {
        jobId: "job-new",
        reviewId: "review-history",
        requestedAt: "2026-03-10T00:02:00.000Z",
        reason: "manual_reanalysis",
        status: "failed",
        queuedAt: "2026-03-10T00:02:01.000Z",
        startedAt: "2026-03-10T00:02:02.000Z",
        completedAt: "2026-03-10T00:02:05.000Z",
        durationMs: 3000,
        attempts: 3,
        lastError: "temporary failure",
      },
    ]);
  });
});
