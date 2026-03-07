#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

import { diffSources, formatChanges } from "./index.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");

  if (positional.length !== 2) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const [beforePath, afterPath] = positional;
  const [beforeSource, afterSource] = await Promise.all([
    readFile(beforePath, "utf8"),
    readFile(afterPath, "utf8"),
  ]);

  const changes = diffSources(beforeSource, afterSource, {
    beforePath,
    afterPath,
  });

  if (json) {
    console.log(JSON.stringify(changes, null, 2));
    return;
  }

  console.log(formatChanges(changes));
}

function printUsage(): void {
  console.error("Usage: locus-semantic-diff [--json] <before-file> <after-file>");
}

void main();
