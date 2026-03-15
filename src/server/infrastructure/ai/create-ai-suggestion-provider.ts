import type { AiSuggestionProvider } from "@/server/application/ports/ai-suggestion-provider";
import {
  type AiSuggestionProviderGuardrailPolicy,
  GuardrailedAiSuggestionProvider,
} from "@/server/infrastructure/ai/guardrailed-ai-suggestion-provider";
import { HeuristicAiSuggestionProvider } from "@/server/infrastructure/ai/heuristic-ai-suggestion-provider";
import { LlmAiSuggestionProvider } from "@/server/infrastructure/ai/llm-ai-suggestion-provider";
import { OpenAiCompatibleAiSuggestionClient } from "@/server/infrastructure/ai/openai-compatible-ai-suggestion-client";

type Logger = Pick<typeof console, "warn">;
type EnvMap = Readonly<Record<string, string | undefined>>;

export type AiSuggestionProviderMode = "heuristic" | "openai_compat";

interface FactoryInput {
  env?: EnvMap;
  fetchFn?: typeof fetch;
  logger?: Logger;
}

const PROVIDER_MODE_ENV = "LOCUS_AI_SUGGESTION_PROVIDER";
const OPENAI_API_KEY_ENV = "LOCUS_AI_SUGGESTION_OPENAI_API_KEY";
const OPENAI_MODEL_ENV = "LOCUS_AI_SUGGESTION_OPENAI_MODEL";
const OPENAI_BASE_URL_ENV = "LOCUS_AI_SUGGESTION_OPENAI_BASE_URL";
const OPENAI_ORG_ENV = "LOCUS_AI_SUGGESTION_OPENAI_ORGANIZATION";
const OPENAI_PROJECT_ENV = "LOCUS_AI_SUGGESTION_OPENAI_PROJECT";
const PROMPT_VERSION_ENV = "LOCUS_AI_SUGGESTION_PROMPT_VERSION";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_PROMPT_VERSION = "openai_compat.v1";

function readOptionalPositiveIntegerEnv(name: string, env: EnvMap): number | undefined {
  const value = env[name]?.trim();

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  if (String(parsed) !== value) {
    return undefined;
  }

  return parsed;
}

function readOptionalPositiveNumberEnv(name: string, env: EnvMap): number | undefined {
  const value = env[name]?.trim();

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function toProviderEnvKey(providerName: string): string {
  return providerName.replace(/[^a-z0-9]/gi, "_").toUpperCase();
}

function readAiSuggestionGuardrailPolicy(
  providerName: string,
  env: EnvMap,
): AiSuggestionProviderGuardrailPolicy {
  const keyPrefix = `LOCUS_AI_SUGGESTION_PROVIDER_${toProviderEnvKey(providerName)}`;

  return {
    timeoutMs: readOptionalPositiveIntegerEnv(`${keyPrefix}_TIMEOUT_MS`, env) ?? 3000,
    maxEstimatedInputTokens: readOptionalPositiveIntegerEnv(
      `${keyPrefix}_MAX_ESTIMATED_INPUT_TOKENS`,
      env,
    ),
    maxEstimatedInputCostUsd: readOptionalPositiveNumberEnv(
      `${keyPrefix}_MAX_ESTIMATED_INPUT_COST_USD`,
      env,
    ),
    estimatedInputCostPer1kInputTokensUsd: readOptionalPositiveNumberEnv(
      `${keyPrefix}_ESTIMATED_INPUT_USD_PER_1K_TOKENS`,
      env,
    ),
  };
}

function resolveProviderMode(raw: string | undefined): AiSuggestionProviderMode {
  if (!raw) {
    return "heuristic";
  }

  return raw.trim().toLowerCase() === "openai_compat" ? "openai_compat" : "heuristic";
}

export function createAiSuggestionProvider(input: FactoryInput = {}): AiSuggestionProvider {
  const env = input.env ?? process.env;
  const logger = input.logger ?? console;
  const mode = resolveProviderMode(env[PROVIDER_MODE_ENV]);

  const heuristicPrimaryProvider = new HeuristicAiSuggestionProvider();
  const heuristicFallbackProvider = new HeuristicAiSuggestionProvider();

  const fallbackToHeuristicProvider = () =>
    new GuardrailedAiSuggestionProvider({
      providerName: "heuristic",
      provider: heuristicPrimaryProvider,
      fallbackProviderName: "heuristic",
      fallbackProvider: heuristicFallbackProvider,
      guardrailPolicy: readAiSuggestionGuardrailPolicy("heuristic", env),
    });

  if (mode !== "openai_compat") {
    return fallbackToHeuristicProvider();
  }

  const apiKey = env[OPENAI_API_KEY_ENV]?.trim();
  if (!apiKey) {
    logger.warn("ai_suggestion_provider_config_fallback", {
      reason: "missing_openai_api_key",
      mode,
      missingEnv: OPENAI_API_KEY_ENV,
    });
    return fallbackToHeuristicProvider();
  }

  const model = env[OPENAI_MODEL_ENV]?.trim() || DEFAULT_OPENAI_MODEL;
  const promptVersion = env[PROMPT_VERSION_ENV]?.trim() || DEFAULT_PROMPT_VERSION;
  const llmProvider = new LlmAiSuggestionProvider({
    promptVersion,
    client: new OpenAiCompatibleAiSuggestionClient({
      apiKey,
      model,
      baseUrl: env[OPENAI_BASE_URL_ENV]?.trim(),
      organization: env[OPENAI_ORG_ENV]?.trim(),
      project: env[OPENAI_PROJECT_ENV]?.trim(),
      fetchFn: input.fetchFn,
    }),
  });

  return new GuardrailedAiSuggestionProvider({
    providerName: "openai_compat",
    provider: llmProvider,
    fallbackProviderName: "heuristic",
    fallbackProvider: heuristicFallbackProvider,
    guardrailPolicy: readAiSuggestionGuardrailPolicy("openai_compat", env),
  });
}
