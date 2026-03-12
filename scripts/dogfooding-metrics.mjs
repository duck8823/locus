#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

export function toFixedOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

export function loadJobs(rawStore) {
  if (!rawStore || !Array.isArray(rawStore.jobs)) {
    return [];
  }

  return rawStore.jobs.filter((job) => job && typeof job === "object");
}

export function calculateMetrics(jobs) {
  const terminalJobs = jobs.filter((job) => job.status === "succeeded" || job.status === "failed");
  const durationValues = terminalJobs
    .map((job) => job.durationMs)
    .filter((durationMs) => Number.isFinite(durationMs) && durationMs >= 0);
  const averageDurationMs =
    durationValues.length > 0
      ? Math.round(durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length)
      : null;
  const failureRatePercent =
    terminalJobs.length > 0
      ? toFixedOneDecimal((terminalJobs.filter((job) => job.status === "failed").length / terminalJobs.length) * 100)
      : null;
  const manualJobs = jobs.filter((job) => job.reason === "manual_reanalysis");
  const recoverySuccessRatePercent =
    manualJobs.length > 0
      ? toFixedOneDecimal((manualJobs.filter((job) => job.status === "succeeded").length / manualJobs.length) * 100)
      : null;

  return {
    totalJobs: jobs.length,
    terminalJobs: terminalJobs.length,
    averageDurationMs,
    failureRatePercent,
    recoverySuccessRatePercent,
  };
}

export function groupByReviewId(jobs) {
  const grouped = new Map();

  for (const job of jobs) {
    if (typeof job.reviewId !== "string" || job.reviewId.trim().length === 0) {
      continue;
    }

    const current = grouped.get(job.reviewId) ?? [];
    current.push(job);
    grouped.set(job.reviewId, current);
  }

  return grouped;
}

export async function runDogfoodingMetrics(params = {}) {
  const jobsFilePath =
    params.jobsFilePath ??
    process.env.LOCUS_ANALYSIS_JOBS_FILE_PATH ??
    path.join(process.cwd(), ".locus-data", "analysis-jobs", "jobs.json");

  const raw = await readFile(jobsFilePath, "utf8");
  const parsed = JSON.parse(raw);
  const jobs = loadJobs(parsed);
  const globalMetrics = calculateMetrics(jobs);

  const byReview = [...groupByReviewId(jobs).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reviewId, reviewJobs]) => ({
      reviewId,
      ...calculateMetrics(reviewJobs),
    }));

  return {
    generatedAt: new Date().toISOString(),
    jobsFilePath,
    global: globalMetrics,
    byReview,
  };
}

async function main() {
  const output = await runDogfoodingMetrics();
  process.stdout.write(
    `${JSON.stringify(
      output,
      null,
      2,
    )}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`dogfooding metrics failed: ${message}\n`);
    process.exitCode = 1;
  });
}
