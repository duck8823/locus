#!/usr/bin/env node

import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

async function readLegacyConnectionStateSummary(dataDir) {
  const connectionStatesDir = path.join(dataDir, "connection-states");

  try {
    const fileNames = await readdir(connectionStatesDir);

    return {
      connectionStatesDir,
      exists: true,
      total: fileNames.filter((fileName) => fileName.endsWith(".json")).length,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        connectionStatesDir,
        exists: false,
        total: 0,
      };
    }

    throw error;
  }
}

async function readConnectionStateDatabaseSummary(dataDir) {
  const databasePath = path.join(dataDir, "connection-state.sqlite");

  try {
    await access(databasePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        databasePath,
        exists: false,
        stateCount: 0,
        transitionCount: 0,
      };
    }

    throw error;
  }

  const database = new DatabaseSync(databasePath);

  try {
    initializeConnectionStateSchema(database);

    const stateCount = Number(
      database.prepare("SELECT COUNT(*) AS count FROM connection_states").get()?.count ?? 0,
    );
    const transitionCount = Number(
      database
        .prepare("SELECT COUNT(*) AS count FROM connection_state_transitions")
        .get()?.count ?? 0,
    );

    return {
      databasePath,
      exists: true,
      stateCount,
      transitionCount,
    };
  } finally {
    database.close();
  }
}

function assertSafeDataDirectory(dataDir) {
  if (path.basename(dataDir) !== ".locus-data") {
    throw new Error(
      `Refusing to operate on non-demo directory: ${dataDir}. ` +
        "Use a path that ends with '.locus-data'.",
    );
  }
}

function initializeConnectionStateSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS connection_states (
      reviewer_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      status_updated_at TEXT,
      connected_account_label TEXT,
      PRIMARY KEY (reviewer_id, provider)
    );

    CREATE TABLE IF NOT EXISTS connection_state_transitions (
      transition_id TEXT PRIMARY KEY,
      reviewer_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      next_status TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      connected_account_label TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_connection_state_transitions_reviewer_changed
      ON connection_state_transitions (reviewer_id, changed_at DESC, transition_id DESC);
  `);
}

async function showStatus(dataDir) {
  const [jobsSummary, reviewSessionSummary, legacyConnectionStateSummary, databaseSummary] =
    await Promise.all([
      readJobsSummary(dataDir),
      readReviewSessionSummary(dataDir),
      readLegacyConnectionStateSummary(dataDir),
      readConnectionStateDatabaseSummary(dataDir),
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
  console.log(
    `Connection state profiles (legacy files): ${legacyConnectionStateSummary.total}${
      legacyConnectionStateSummary.exists ? "" : " (directory missing)"
    }`,
  );
  console.log(
    `Connection state DB rows: ${databaseSummary.stateCount}${
      databaseSummary.exists ? "" : " (db missing)"
    }`,
  );
  console.log(`Connection transition rows: ${databaseSummary.transitionCount}`);

  if (jobsSummary.byStatus.size > 0) {
    const statusSummary = [...jobsSummary.byStatus.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `${status}:${count}`)
      .join(", ");

    console.log(`Job status breakdown: ${statusSummary}`);
  }
}

async function resetData(dataDir) {
  assertSafeDataDirectory(dataDir);
  await rm(dataDir, { recursive: true, force: true });
  console.log(`Removed demo data directory: ${dataDir}`);
}

function seedConnectionStateDatabase(databasePath) {
  const database = new DatabaseSync(databasePath);

  try {
    initializeConnectionStateSchema(database);
    database.exec("BEGIN IMMEDIATE TRANSACTION");

    try {
      database.exec("DELETE FROM connection_state_transitions");
      database.exec("DELETE FROM connection_states");

      const seededAt = "2026-03-11T00:00:00.000Z";
      const seedRows = [
        {
          reviewerId: "Demo reviewer",
          provider: "github",
          status: "connected",
          connectedAccountLabel: "duck8823",
        },
        {
          reviewerId: "デモレビュアー",
          provider: "github",
          status: "connected",
          connectedAccountLabel: "duck8823",
        },
      ];

      const insertState = database.prepare(
        `INSERT INTO connection_states (
          reviewer_id,
          provider,
          status,
          status_updated_at,
          connected_account_label
        ) VALUES (?, ?, ?, ?, ?)`,
      );
      const insertTransition = database.prepare(
        `INSERT INTO connection_state_transitions (
          transition_id,
          reviewer_id,
          provider,
          previous_status,
          next_status,
          changed_at,
          connected_account_label
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const row of seedRows) {
        insertState.run(
          row.reviewerId,
          row.provider,
          row.status,
          seededAt,
          row.connectedAccountLabel,
        );

        insertTransition.run(
          `${encodeURIComponent(row.reviewerId)}-${row.provider}-${seededAt}`,
          row.reviewerId,
          row.provider,
          "not_connected",
          row.status,
          seededAt,
          row.connectedAccountLabel,
        );
      }

      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

async function reseedData(dataDir) {
  assertSafeDataDirectory(dataDir);

  const reviewSessionsDir = path.join(dataDir, "review-sessions");
  const analysisJobsDir = path.join(dataDir, "analysis-jobs");
  const legacyConnectionStatesDir = path.join(dataDir, "connection-states");
  const databasePath = path.join(dataDir, "connection-state.sqlite");

  await mkdir(dataDir, { recursive: true });

  await Promise.all([
    rm(reviewSessionsDir, { recursive: true, force: true }),
    rm(analysisJobsDir, { recursive: true, force: true }),
    rm(legacyConnectionStatesDir, { recursive: true, force: true }),
  ]);

  await mkdir(reviewSessionsDir, { recursive: true });
  await mkdir(analysisJobsDir, { recursive: true });
  await mkdir(legacyConnectionStatesDir, { recursive: true });
  await writeFile(path.join(analysisJobsDir, "jobs.json"), JSON.stringify({ jobs: [] }, null, 2));
  seedConnectionStateDatabase(databasePath);

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
