import { z } from "zod/v4";

// --- Custom transformers ---

const optionalNonNegativeInteger = z
  .string()
  .optional()
  .transform((val) => {
    const trimmed = val?.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;
    const n = Number(trimmed);
    return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
  });

const featureFlag = z
  .string()
  .optional()
  .transform((val) => {
    const v = val?.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  });

const optionalTrimmed = z
  .string()
  .optional()
  .transform((val) => val?.trim() || undefined);

const aiProviderMode = z
  .string()
  .optional()
  .transform((val): "heuristic" | "openai_compat" | "anthropic" => {
    const normalized = val?.trim().toLowerCase();
    if (normalized === "openai_compat") return "openai_compat";
    if (normalized === "anthropic") return "anthropic";
    return "heuristic";
  });

// --- Schema ---

export const envSchema = z.object({
  // Node
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),

  // Auth.js
  AUTH_SECRET: optionalTrimmed,
  AUTH_GITHUB_ID: optionalTrimmed,
  AUTH_GITHUB_SECRET: optionalTrimmed,

  // Database
  DATABASE_URL: optionalTrimmed,

  // GitHub
  GITHUB_TOKEN: optionalTrimmed,
  GH_TOKEN: optionalTrimmed,
  GITHUB_OAUTH_CLIENT_ID: optionalTrimmed,
  GITHUB_OAUTH_CLIENT_SECRET: optionalTrimmed,
  GITHUB_OAUTH_SCOPE: optionalTrimmed,
  GITHUB_WEBHOOK_SECRET: optionalTrimmed,

  // GitHub demo
  LOCUS_GITHUB_DEMO_OWNER: optionalTrimmed,
  LOCUS_GITHUB_DEMO_REPO: optionalTrimmed,
  LOCUS_GITHUB_DEMO_PR_NUMBER: optionalTrimmed,

  // GitLab
  GITLAB_TOKEN: optionalTrimmed,
  GL_TOKEN: optionalTrimmed,
  LOCUS_ENABLE_GITLAB_ADAPTER: featureFlag,

  // GitLab demo
  LOCUS_GITLAB_DEMO_PROJECT_PATH: optionalTrimmed,
  LOCUS_GITLAB_DEMO_MR_IID: optionalTrimmed,

  // Jira
  JIRA_API_BASE_URL: optionalTrimmed,
  JIRA_ACCESS_TOKEN: optionalTrimmed,
  JIRA_AUTH_SCHEME: optionalTrimmed,

  // Confluence
  CONFLUENCE_API_BASE_URL: optionalTrimmed,
  CONFLUENCE_ACCESS_TOKEN: optionalTrimmed,

  // Analysis job scheduler
  LOCUS_ANALYSIS_JOB_STALE_RUNNING_MS: optionalNonNegativeInteger,
  LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS: optionalNonNegativeInteger,
  LOCUS_ANALYSIS_JOB_MAX_RETAINED_TERMINAL_JOBS: optionalNonNegativeInteger,
  LOCUS_CONNECTION_TRANSITION_MAX_RETAINED: optionalNonNegativeInteger,

  // Plugin capabilities
  LOCUS_PLUGIN_CAPABILITY_ALLOWLIST: optionalTrimmed,
  LOCUS_PLUGIN_CAPABILITY_DENYLIST: optionalTrimmed,

  // AI suggestion provider
  LOCUS_AI_SUGGESTION_PROVIDER: aiProviderMode,
  LOCUS_AI_SUGGESTION_OPENAI_API_KEY: optionalTrimmed,
  LOCUS_AI_SUGGESTION_OPENAI_MODEL: optionalTrimmed,
  LOCUS_AI_SUGGESTION_OPENAI_BASE_URL: optionalTrimmed,
  LOCUS_AI_SUGGESTION_OPENAI_ORGANIZATION: optionalTrimmed,
  LOCUS_AI_SUGGESTION_OPENAI_PROJECT: optionalTrimmed,
  LOCUS_AI_SUGGESTION_ANTHROPIC_API_KEY: optionalTrimmed,
  LOCUS_AI_SUGGESTION_ANTHROPIC_MODEL: optionalTrimmed,
  LOCUS_AI_SUGGESTION_ANTHROPIC_BASE_URL: optionalTrimmed,
  LOCUS_AI_SUGGESTION_PROMPT_VERSION: optionalTrimmed,

  // AI suggestion guardrail per-provider env (dynamic prefix, handled separately)
  // Benchmark flags (test-only)
  ANALYZE_SNAPSHOTS_BENCHMARK: optionalTrimmed,
  ANALYZE_SNAPSHOTS_REAL_PR_BENCHMARK: optionalTrimmed,
});

export type Env = z.infer<typeof envSchema>;

// Secret keys whose values should be masked in logs
const SECRET_KEYS: ReadonlySet<string> = new Set([
  "DATABASE_URL",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "GITHUB_WEBHOOK_SECRET",
  "GITLAB_TOKEN",
  "GL_TOKEN",
  "JIRA_ACCESS_TOKEN",
  "CONFLUENCE_ACCESS_TOKEN",
  "LOCUS_AI_SUGGESTION_OPENAI_API_KEY",
  "LOCUS_AI_SUGGESTION_ANTHROPIC_API_KEY",
  "AUTH_SECRET",
  "AUTH_GITHUB_SECRET",
]);

function maskValue(key: string, value: unknown): string {
  if (SECRET_KEYS.has(key) && typeof value === "string" && value.length > 0) {
    return `${value.slice(0, 4)}****`;
  }
  return String(value ?? "");
}

/**
 * Parse and validate environment variables. Throws on validation failure with
 * a human-readable message (secret values are masked).
 */
export function parseEnv(raw: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `  ${path}: ${issue.message}`;
    });
    throw new Error(`Environment variable validation failed:\n${messages.join("\n")}`);
  }

  return result.data;
}

/**
 * Returns a redacted summary of parsed env for logging.
 * Secret values are masked; undefined values are omitted.
 */
export function summarizeEnv(env: Env): Record<string, string> {
  const summary: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === false) continue;
    summary[key] = maskValue(key, value);
  }

  return summary;
}

// --- Singleton ---

let cachedEnv: Env | null = null;

/**
 * Returns validated environment variables. Parses on first call and caches the result.
 * Call at application startup to fail fast on misconfiguration.
 */
export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = parseEnv();
  }
  return cachedEnv;
}

/**
 * Reset the cached env (for testing).
 */
export function resetEnvCache(): void {
  cachedEnv = null;
}
