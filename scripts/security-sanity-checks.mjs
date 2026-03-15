#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ALLOWED_DOTENV_BASENAMES = new Set([".env.example", ".env.sample", ".env.template"]);

const SECRET_PATTERNS = [
  {
    id: "github_pat_classic",
    description: "GitHub personal access token-like value",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
  },
  {
    id: "github_pat_fine_grained",
    description: "GitHub fine-grained PAT-like value",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  },
  {
    id: "openai_api_key",
    description: "OpenAI API key-like value",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/,
  },
  {
    id: "aws_access_key",
    description: "AWS access key-like value",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    id: "slack_token",
    description: "Slack token-like value",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
];

function maskMatch(value) {
  if (value.length <= 12) {
    return "<redacted>";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function isLikelyBinary(buffer) {
  if (buffer.length === 0) {
    return false;
  }

  let suspiciousBytes = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      return true;
    }
    const isControl = byte < 9 || (byte > 13 && byte < 32);
    if (isControl) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes / buffer.length > 0.3;
}

function isBlockedDotenvFile(filePath) {
  const basename = path.posix.basename(filePath);
  if (!basename.startsWith(".env")) {
    return false;
  }

  return !ALLOWED_DOTENV_BASENAMES.has(basename);
}

export function collectBlockedDotenvFiles(files) {
  return files.filter(isBlockedDotenvFile).sort();
}

export function scanSecretPatterns(content) {
  const findings = [];
  for (const rule of SECRET_PATTERNS) {
    const match = rule.pattern.exec(content);
    if (!match) {
      continue;
    }
    findings.push({
      ruleId: rule.id,
      description: rule.description,
      matchedPreview: maskMatch(match[0]),
    });
  }
  return findings;
}

export async function listTrackedFiles({ cwd = process.cwd() } = {}) {
  const { stdout } = await execFileAsync("git", ["ls-files"], { cwd });
  return stdout
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => file.length > 0);
}

export async function runSecuritySanityChecks({
  cwd = process.cwd(),
  files,
  readFileFn = readFile,
  statFn = stat,
  listTrackedFilesFn = listTrackedFiles,
  maxScanFileBytes = 1_000_000,
} = {}) {
  const trackedFiles = files ?? (await listTrackedFilesFn({ cwd }));
  const blockedDotenvFiles = collectBlockedDotenvFiles(trackedFiles);
  const violations = blockedDotenvFiles.map((filePath) => ({
    type: "blocked_dotenv",
    filePath,
    message:
      "Tracked .env* file detected. Use .env.example/.env.sample/.env.template only and keep secrets out of git.",
  }));

  let scannedTextFiles = 0;
  let skippedBinaryFiles = 0;
  let skippedLargeFiles = 0;

  for (const filePath of trackedFiles) {
    const absolutePath = path.join(cwd, filePath);
    const stats = await statFn(absolutePath);

    if (stats.size > maxScanFileBytes) {
      skippedLargeFiles += 1;
      continue;
    }

    const raw = await readFileFn(absolutePath);

    if (isLikelyBinary(raw)) {
      skippedBinaryFiles += 1;
      continue;
    }

    scannedTextFiles += 1;
    const content = raw.toString("utf8");
    const matches = scanSecretPatterns(content);

    for (const match of matches) {
      violations.push({
        type: "secret_pattern",
        filePath,
        ruleId: match.ruleId,
        message: `${match.description} found (${match.matchedPreview})`,
      });
    }
  }

  return {
    violations,
    scannedTextFiles,
    skippedBinaryFiles,
    skippedLargeFiles,
  };
}

async function main() {
  const result = await runSecuritySanityChecks();

  if (result.violations.length > 0) {
    process.stderr.write("security sanity checks failed:\n");
    for (const violation of result.violations) {
      process.stderr.write(`- [${violation.type}] ${violation.filePath}: ${violation.message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `security sanity checks passed (scanned text files: ${result.scannedTextFiles}, skipped binary files: ${result.skippedBinaryFiles}, skipped large files: ${result.skippedLargeFiles})\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`security sanity checks failed: ${message}\n`);
    process.exitCode = 1;
  });
}
