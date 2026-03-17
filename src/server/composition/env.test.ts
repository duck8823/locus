import { describe, it, expect, afterEach } from "vitest";
import { parseEnv, summarizeEnv, getEnv, resetEnvCache } from "./env";

afterEach(() => {
  resetEnvCache();
});

describe("parseEnv", () => {
  it("parses minimal (empty) env without errors", () => {
    const env = parseEnv({});
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.LOCUS_AI_SUGGESTION_PROVIDER).toBe("heuristic");
    expect(env.LOCUS_ENABLE_GITLAB_ADAPTER).toBe(false);
  });

  it("parses DATABASE_URL", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://localhost/locus" });
    expect(env.DATABASE_URL).toBe("postgres://localhost/locus");
  });

  it("trims string values", () => {
    const env = parseEnv({ GITHUB_TOKEN: "  ghp_abc123  " });
    expect(env.GITHUB_TOKEN).toBe("ghp_abc123");
  });

  it("treats empty strings as undefined for optional trimmed", () => {
    const env = parseEnv({ GITHUB_TOKEN: "" });
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it("treats whitespace-only as undefined for optional trimmed", () => {
    const env = parseEnv({ GITHUB_TOKEN: "   " });
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  describe("feature flags", () => {
    it.each(["1", "true", "TRUE", "yes", "on", " True "])("returns true for %s", (val) => {
      const env = parseEnv({ LOCUS_ENABLE_GITLAB_ADAPTER: val });
      expect(env.LOCUS_ENABLE_GITLAB_ADAPTER).toBe(true);
    });

    it.each(["0", "false", "", "no", "off"])("returns false for %s", (val) => {
      const env = parseEnv({ LOCUS_ENABLE_GITLAB_ADAPTER: val });
      expect(env.LOCUS_ENABLE_GITLAB_ADAPTER).toBe(false);
    });

    it("returns false when undefined", () => {
      const env = parseEnv({});
      expect(env.LOCUS_ENABLE_GITLAB_ADAPTER).toBe(false);
    });
  });

  describe("non-negative integer env", () => {
    it("parses valid integers", () => {
      const env = parseEnv({ LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS: "5" });
      expect(env.LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS).toBe(5);
    });

    it("parses zero", () => {
      const env = parseEnv({ LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS: "0" });
      expect(env.LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS).toBe(0);
    });

    it("returns undefined for non-numeric", () => {
      const env = parseEnv({ LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS: "abc" });
      expect(env.LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS).toBeUndefined();
    });

    it("returns undefined for negative", () => {
      const env = parseEnv({ LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS: "-1" });
      expect(env.LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS).toBeUndefined();
    });

    it("returns undefined for float", () => {
      const env = parseEnv({ LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS: "3.5" });
      expect(env.LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      const env = parseEnv({ LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS: "" });
      expect(env.LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS).toBeUndefined();
    });
  });

  describe("AI suggestion provider mode", () => {
    it("defaults to heuristic when absent", () => {
      const env = parseEnv({});
      expect(env.LOCUS_AI_SUGGESTION_PROVIDER).toBe("heuristic");
    });

    it("recognizes openai_compat", () => {
      const env = parseEnv({ LOCUS_AI_SUGGESTION_PROVIDER: "openai_compat" });
      expect(env.LOCUS_AI_SUGGESTION_PROVIDER).toBe("openai_compat");
    });

    it("recognizes anthropic", () => {
      const env = parseEnv({ LOCUS_AI_SUGGESTION_PROVIDER: "anthropic" });
      expect(env.LOCUS_AI_SUGGESTION_PROVIDER).toBe("anthropic");
    });

    it("falls back to heuristic for unknown value", () => {
      const env = parseEnv({ LOCUS_AI_SUGGESTION_PROVIDER: "unknown" });
      expect(env.LOCUS_AI_SUGGESTION_PROVIDER).toBe("heuristic");
    });

    it("is case-insensitive and trims", () => {
      const env = parseEnv({ LOCUS_AI_SUGGESTION_PROVIDER: " Anthropic " });
      expect(env.LOCUS_AI_SUGGESTION_PROVIDER).toBe("anthropic");
    });
  });

  describe("NODE_ENV", () => {
    it("accepts valid values", () => {
      expect(parseEnv({ NODE_ENV: "production" }).NODE_ENV).toBe("production");
      expect(parseEnv({ NODE_ENV: "development" }).NODE_ENV).toBe("development");
      expect(parseEnv({ NODE_ENV: "test" }).NODE_ENV).toBe("test");
    });

    it("rejects invalid values", () => {
      expect(() => parseEnv({ NODE_ENV: "staging" })).toThrow("Environment variable validation failed");
    });
  });
});

describe("summarizeEnv", () => {
  it("masks secret values", () => {
    const env = parseEnv({
      GITHUB_TOKEN: "ghp_1234567890abcdef",
      DATABASE_URL: "postgres://user:pass@localhost/db",
    });
    const summary = summarizeEnv(env);
    expect(summary.GITHUB_TOKEN).toBe("ghp_****");
    expect(summary.DATABASE_URL).toBe("post****");
  });

  it("omits undefined values", () => {
    const env = parseEnv({});
    const summary = summarizeEnv(env);
    expect(summary).not.toHaveProperty("GITHUB_TOKEN");
    expect(summary).not.toHaveProperty("DATABASE_URL");
  });

  it("shows non-secret values in plain text", () => {
    const env = parseEnv({ LOCUS_AI_SUGGESTION_OPENAI_MODEL: "gpt-4o" });
    const summary = summarizeEnv(env);
    expect(summary.LOCUS_AI_SUGGESTION_OPENAI_MODEL).toBe("gpt-4o");
  });
});

describe("getEnv (singleton)", () => {
  it("caches the result across calls", () => {
    const env1 = getEnv();
    const env2 = getEnv();
    expect(env1).toBe(env2);
  });
});
