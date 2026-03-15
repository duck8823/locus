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

function createStatStub({ cwd, fileContents, binaryFiles = new Set(), largeFiles = new Set() }) {
  return async (absolutePath) => {
    const relativePath = path.relative(cwd, absolutePath).replaceAll("\\", "/");
    if (largeFiles.has(relativePath)) {
      return { size: 2_000_000 };
    }
    if (binaryFiles.has(relativePath)) {
      return { size: 10 };
    }
    const contents = fileContents[relativePath];
    if (contents === undefined) {
      throw new Error(`unexpected stat path: ${relativePath}`);
    }
    return { size: Buffer.byteLength(contents, "utf8") };
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
    const githubClassic = `ghp_${"123456789012345678901234567890123456"}`;
    const openAiLike = `sk-${"abcdefghijklmnopqrstuvwx"}`;
    const findings = scanSecretPatterns(
      `const token = "${githubClassic}"; const key = "${openAiLike}";`,
    );

    expect(findings.map((item) => item.ruleId).sort()).toEqual(["github_pat_classic", "openai_api_key"]);
  });

  it("returns all matches within the same file", () => {
    const tokenA = `ghp_${"123456789012345678901234567890123456"}`;
    const tokenB = `ghp_${"abcdefghijklmnopqrstuvwx123456789012"}`;
    const findings = scanSecretPatterns(`const a="${tokenA}"; const b="${tokenB}";`);
    expect(findings.filter((item) => item.ruleId === "github_pat_classic")).toHaveLength(2);
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
        "src/server/token.ts": `export const token = "${`github_pat_${"abcdefghijklmnopqrstuv_1234567890"}`}";`,
      },
    });
    const statFn = createStatStub({
      cwd,
      fileContents: {
        ".env.local": "SOME_VAR=1",
        "src/server/token.ts": `export const token = "${`github_pat_${"abcdefghijklmnopqrstuv_1234567890"}`}";`,
      },
    });

    const result = await runSecuritySanityChecks({
      cwd,
      files,
      readFileFn,
      statFn,
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
    const statFn = createStatStub({
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
      statFn,
    });

    expect(result.violations).toEqual([]);
    expect(result.scannedTextFiles).toBe(1);
    expect(result.skippedBinaryFiles).toBe(1);
    expect(result.skippedLargeFiles).toBe(0);
  });

  it("skips files larger than maxScanFileBytes", async () => {
    const cwd = "/repo";
    const files = ["README.md", "artifacts/huge.json"];
    const readFileFn = createReadFileStub({
      cwd,
      fileContents: {
        "README.md": "# demo",
        "artifacts/huge.json": '{"very":"large"}',
      },
    });
    const statFn = createStatStub({
      cwd,
      fileContents: {
        "README.md": "# demo",
        "artifacts/huge.json": '{"very":"large"}',
      },
      largeFiles: new Set(["artifacts/huge.json"]),
    });

    const result = await runSecuritySanityChecks({
      cwd,
      files,
      readFileFn,
      statFn,
      maxScanFileBytes: 1024,
    });

    expect(result.violations).toEqual([]);
    expect(result.scannedTextFiles).toBe(1);
    expect(result.skippedLargeFiles).toBe(1);
  });

  it("continues scanning when a file read/stat fails", async () => {
    const cwd = "/repo";
    const files = ["README.md", "broken/link.txt"];
    const readFileFn = async (absolutePath) => {
      const relativePath = path.relative(cwd, absolutePath).replaceAll("\\", "/");
      if (relativePath === "README.md") {
        return Buffer.from("# demo", "utf8");
      }
      throw new Error("link target missing");
    };
    const statFn = async (absolutePath) => {
      const relativePath = path.relative(cwd, absolutePath).replaceAll("\\", "/");
      if (relativePath === "README.md") {
        return { size: 6 };
      }
      throw new Error("stat failed");
    };

    const result = await runSecuritySanityChecks({
      cwd,
      files,
      readFileFn,
      statFn,
    });

    expect(result.scannedTextFiles).toBe(1);
    expect(result.violations).toEqual([
      {
        type: "scan_error",
        filePath: "broken/link.txt",
        message: "Failed to scan file: stat failed",
      },
    ]);
  });
});
