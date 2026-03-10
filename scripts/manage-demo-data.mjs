#!/usr/bin/env node

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function printUsage() {
  console.log(`Usage:
  node scripts/manage-demo-data.mjs status [--data-dir <path>]
  node scripts/manage-demo-data.mjs reset [--data-dir <path>]
  node scripts/manage-demo-data.mjs reseed [--data-dir <path>]
`);
}

function parseArgs(argv) {
  const [, , command, ...rest] = argv;
  const options = {
    command,
    dataDir: path.resolve(process.cwd(), ".locus-data"),
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token === "--data-dir") {
      const value = rest[index + 1];

      if (!value) {
        throw new Error("--data-dir requires a value.");
      }

      options.dataDir = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return options;
}

async function readJobsSummary(dataDir) {
  const jobsFilePath = path.join(dataDir, "analysis-jobs", "jobs.json");

  try {
    const raw = await readFile(jobsFilePath, "utf8");
    const parsed = JSON.parse(raw);
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    const summary = jobs.reduce(
      (accumulator, job) => {
        const status = typeof job?.status === "string" ? job.status : "unknown";
        accumulator.byStatus.set(status, (accumulator.byStatus.get(status) ?? 0) + 1);
        return accumulator;
      },
      { total: jobs.length, byStatus: new Map() },
    );

    return {
      jobsFilePath,
      exists: true,
      ...summary,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        jobsFilePath,
        exists: false,
        total: 0,
        byStatus: new Map(),
      };
    }

    throw error;
  }
}

async function readReviewSessionSummary(dataDir) {
  const reviewSessionsDir = path.join(dataDir, "review-sessions");

  try {
    const fileNames = await readdir(reviewSessionsDir);

    return {
      reviewSessionsDir,
      exists: true,
      total: fileNames.filter((fileName) => fileName.endsWith(".json")).length,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        reviewSessionsDir,
        exists: false,
        total: 0,
      };
    }

    throw error;
  }
}

async function showStatus(dataDir) {
  const [jobsSummary, reviewSessionSummary] = await Promise.all([
    readJobsSummary(dataDir),
    readReviewSessionSummary(dataDir),
  ]);

  console.log(`Data directory: ${dataDir}`);
  console.log(
    `Review sessions: ${reviewSessionSummary.total}${
      reviewSessionSummary.exists ? "" : " (directory missing)"
    }`,
  );
  console.log(
    `Analysis jobs: ${jobsSummary.total}${jobsSummary.exists ? "" : " (jobs.json missing)"}`,
  );

  if (jobsSummary.byStatus.size > 0) {
    const statusSummary = [...jobsSummary.byStatus.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `${status}:${count}`)
      .join(", ");

    console.log(`Job status breakdown: ${statusSummary}`);
  }
}

async function resetData(dataDir) {
  await rm(dataDir, { recursive: true, force: true });
  console.log(`Removed demo data directory: ${dataDir}`);
}

async function reseedData(dataDir) {
  await resetData(dataDir);

  const reviewSessionsDir = path.join(dataDir, "review-sessions");
  const analysisJobsDir = path.join(dataDir, "analysis-jobs");
  await mkdir(reviewSessionsDir, { recursive: true });
  await mkdir(analysisJobsDir, { recursive: true });
  await writeFile(path.join(analysisJobsDir, "jobs.json"), JSON.stringify({ jobs: [] }, null, 2));

  console.log("Recreated baseline demo data directories.");
  console.log("Seed review session will be generated automatically after opening the seed demo.");
}

async function main() {
  const { command, dataDir } = parseArgs(process.argv);

  switch (command) {
    case "status":
      await showStatus(dataDir);
      return;
    case "reset":
      await resetData(dataDir);
      return;
    case "reseed":
      await reseedData(dataDir);
      return;
    case "-h":
    case "--help":
    case undefined:
      printUsage();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
