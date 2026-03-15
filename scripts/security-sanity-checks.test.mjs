import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectBlockedDotenvFiles,
  runSecuritySanityChecks,
  scanSecretPatterns,
} from "./security-sanity-checks.mjs";

function createReadFileStub({ cwd, fileContents, binaryFiles = new Set() }) {
  return async (absolutePath) => {
    const relativePath = path.relative(cwd, absolutePath).replaceAll("\\", "/");
    if (binaryFiles.has(relativePath)) {
      return Buffer.from([0, 159, 146, 150]);
    }
    const contents = fileContents[relativePath];
    if (contents === undefined) {
      throw new Error(`unexpected file read: ${relativePath}`);
    }
    return Buffer.from(contents, "utf8");
  };
}

describe("collectBlockedDotenvFiles", () => {
  it("blocks tracked .env files except sample variants", () => {
    expect(
      collectBlockedDotenvFiles([
        ".env",
        ".env.local",
        ".env.example",
        "config/.env.production",
        "config/.env.template",
      ]),
    ).toEqual([".env", ".env.local", "config/.env.production"]);
  });
});

describe("scanSecretPatterns", () => {
  it("detects token-like literals", () => {
    const findings = scanSecretPatterns(
      'const token = "ghp_123456789012345678901234567890123456"; const key = "sk-abcdefghijklmnopqrstuvwx";',
    );

    expect(findings.map((item) => item.ruleId).sort()).toEqual(["github_pat_classic", "openai_api_key"]);
  });
});

describe("runSecuritySanityChecks", () => {
  it("reports .env tracking and token findings", async () => {
    const cwd = "/repo";
    const files = [".env.local", "src/server/token.ts"];
    const readFileFn = createReadFileStub({
      cwd,
      fileContents: {
        ".env.local": "SOME_VAR=1",
        "src/server/token.ts": 'export const token = "github_pat_abcdefghijklmnopqrstuv_1234567890";',
      },
    });

    const result = await runSecuritySanityChecks({
      cwd,
      files,
      readFileFn,
    });

    expect(result.violations).toEqual([
      {
        type: "blocked_dotenv",
        filePath: ".env.local",
        message:
          "Tracked .env* file detected. Use .env.example/.env.sample/.env.template only and keep secrets out of git.",
      },
      {
        type: "secret_pattern",
        filePath: "src/server/token.ts",
        ruleId: "github_pat_fine_grained",
        message: "GitHub fine-grained PAT-like value found (gith...7890)",
      },
    ]);
  });

  it("skips binary files and passes clean text files", async () => {
    const cwd = "/repo";
    const files = ["README.md", "assets/icon.png"];
    const readFileFn = createReadFileStub({
      cwd,
      fileContents: {
        "README.md": "# demo",
      },
      binaryFiles: new Set(["assets/icon.png"]),
    });

    const result = await runSecuritySanityChecks({
      cwd,
      files,
      readFileFn,
    });

    expect(result.violations).toEqual([]);
    expect(result.scannedTextFiles).toBe(1);
    expect(result.skippedBinaryFiles).toBe(1);
  });
});

