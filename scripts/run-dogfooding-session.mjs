#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runDogfoodingMetrics } from "./dogfooding-metrics.mjs";

const execFileAsync = promisify(execFile);

async function runCommand(command, args, extraEnv = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
    },
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    command: `${command} ${args.join(" ")}`,
    stdout,
    stderr,
  };
}

function createTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseBenchmarkDuration(stdout, pattern) {
  const match = stdout.match(pattern);

  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function main() {
  const runCommands = [
    {
      command: "npm",
      args: ["run", "demo:data:reseed"],
    },
    {
      command: "npx",
      args: [
        "vitest",
        "run",
        "src/server/infrastructure/parser/analyze-source-snapshots.large-pr.test.ts",
      ],
      env: {
        ANALYZE_SNAPSHOTS_BENCHMARK: "1",
      },
    },
    {
      command: "npx",
      args: [
        "vitest",
        "run",
        "src/server/infrastructure/parser/typescript-parser-adapter.real-pr-fixtures.test.ts",
      ],
      env: {
        ANALYZE_SNAPSHOTS_REAL_PR_BENCHMARK: "1",
      },
    },
  ];

  const commandResults = [];
  let hasFailedCommand = false;

  for (const entry of runCommands) {
    try {
      const result = await runCommand(entry.command, entry.args, entry.env);
      commandResults.push({ ...result, status: "succeeded" });
    } catch (error) {
      hasFailedCommand = true;
      const message = error instanceof Error ? error.message : "Unknown command failure";
      const stdout = typeof error === "object" && error !== null && "stdout" in error
        ? String(error.stdout ?? "")
        : "";
      const stderr = typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr ?? "")
        : "";
      commandResults.push({
        command: `${entry.command} ${entry.args.join(" ")}`,
        stdout,
        stderr,
        status: "failed",
        error: message,
      });
    }
  }

  const syntheticLargePrDurationMs = commandResults
    .filter((result) => result.status === "succeeded")
    .map((result) =>
      parseBenchmarkDuration(
        result.stdout,
        /\[benchmark\]\s+processed\s+\d+\s+files\s+in\s+(\d+)\s+ms/i,
      ))
    .find((duration) => duration !== null) ?? null;
  const realPrFixtureDurationMs = commandResults
    .filter((result) => result.status === "succeeded")
    .map((result) =>
      parseBenchmarkDuration(
        result.stdout,
        /\[benchmark\]\s+analyzed\s+real-pr\s+fixtures\s+in\s+(\d+)\s+ms/i,
      ))
    .find((duration) => duration !== null) ?? null;
  const sessionMetrics = {
    syntheticLargePrDurationMs,
    realPrFixtureDurationMs,
    failedCommandCount: commandResults.filter((result) => result.status === "failed").length,
  };

  const metrics = await runDogfoodingMetrics();
  const warnings = [];

  if (metrics.global.totalJobs === 0) {
    warnings.push(
      "No analysis jobs found in metrics store; job-based KPIs are not representative for this session.",
    );
  }

  const outputDirectory = path.join(process.cwd(), "docs", "performance", "dogfooding-runs");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `run-${createTimestamp()}.json`);

  await writeFile(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        commands: commandResults,
        sessionMetrics,
        metrics,
        warnings,
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write(`${outputPath}\n`);

  if (hasFailedCommand) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`dogfooding session failed: ${message}\n`);
    process.exitCode = 1;
  });
}
