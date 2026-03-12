#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runDogfoodingMetrics } from "./dogfooding-metrics.mjs";

const execFileAsync = promisify(execFile);

async function runCommand(command, args) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    env: process.env,
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

async function main() {
  const runCommands = [
    ["npm", ["run", "demo:data:reseed"]],
    [
      "npx",
      [
        "vitest",
        "run",
        "src/server/infrastructure/parser/analyze-source-snapshots.large-pr.test.ts",
      ],
    ],
    [
      "npx",
      [
        "vitest",
        "run",
        "src/server/infrastructure/parser/typescript-parser-adapter.real-pr-fixtures.test.ts",
      ],
    ],
  ];

  const commandResults = [];

  for (const [command, args] of runCommands) {
    const result = await runCommand(command, args);
    commandResults.push(result);
  }

  const metrics = await runDogfoodingMetrics();
  const outputDirectory = path.join(process.cwd(), "docs", "performance", "dogfooding-runs");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `run-${createTimestamp()}.json`);

  await writeFile(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        commands: commandResults,
        metrics,
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write(`${outputPath}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`dogfooding session failed: ${message}\n`);
    process.exitCode = 1;
  });
}
