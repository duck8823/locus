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
              queuedAt: "2026-03-10T00:00:00.000Z",
              startedAt: "2026-03-10T00:01:00.000Z",
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
});
