import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDogfoodingMetrics } from "./dogfooding-metrics.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("runDogfoodingMetrics", () => {
  it("aggregates speed/failure/recovery metrics from persisted job history", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "locus-dogfood-metrics-"));
    temporaryDirectories.push(root);
    const jobsFilePath = path.join(root, "jobs.json");

    await writeFile(
      jobsFilePath,
      JSON.stringify(
        {
          jobs: [
            {
              jobId: "job-1",
              reviewId: "review-a",
              reason: "initial_ingestion",
              status: "succeeded",
              durationMs: 1000,
            },
            {
              jobId: "job-2",
              reviewId: "review-a",
              reason: "manual_reanalysis",
              status: "failed",
              durationMs: 2000,
            },
            {
              jobId: "job-3",
              reviewId: "review-a",
              reason: "manual_reanalysis",
              status: "succeeded",
              durationMs: 3000,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runDogfoodingMetrics({ jobsFilePath });

    expect(result.global).toEqual({
      totalJobs: 3,
      terminalJobs: 3,
      averageDurationMs: 2000,
      failureRatePercent: 33.3,
      recoverySuccessRatePercent: 50,
    });
    expect(result.byReview).toEqual([
      {
        reviewId: "review-a",
        totalJobs: 3,
        terminalJobs: 3,
        averageDurationMs: 2000,
        failureRatePercent: 33.3,
        recoverySuccessRatePercent: 50,
      },
    ]);
  });
});
