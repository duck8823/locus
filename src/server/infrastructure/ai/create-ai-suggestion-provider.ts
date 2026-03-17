import type { AiSuggestionProvider } from "@/server/application/ports/ai-suggestion-provider";
import {
  type AiSuggestionProviderGuardrailPolicy,
  GuardrailedAiSuggestionProvider,
} from "@/server/infrastructure/ai/guardrailed-ai-suggestion-provider";
import { HeuristicAiSuggestionProvider } from "@/server/infrastructure/ai/heuristic-ai-suggestion-provider";
import { LlmAiSuggestionProvider } from "@/server/infrastructure/ai/llm-ai-suggestion-provider";
import { OpenAiCompatibleAiSuggestionClient } from "@/server/infrastructure/ai/openai-compatible-ai-suggestion-client";
import { AnthropicAiSuggestionClient } from "@/server/infrastructure/ai/anthropic-ai-suggestion-client";

type Logger = Pick<typeof console, "warn">;
type EnvMap = Readonly<Record<string, string | undefined>>;

export type AiSuggestionProviderMode = "heuristic" | "openai_compat" | "anthropic";

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
const ANTHROPIC_API_KEY_ENV = "LOCUS_AI_SUGGESTION_ANTHROPIC_API_KEY";
const ANTHROPIC_MODEL_ENV = "LOCUS_AI_SUGGESTION_ANTHROPIC_MODEL";
const ANTHROPIC_BASE_URL_ENV = "LOCUS_AI_SUGGESTION_ANTHROPIC_BASE_URL";
const PROMPT_VERSION_ENV = "LOCUS_AI_SUGGESTION_PROMPT_VERSION";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_PROMPT_VERSION = "openai_compat.v1";
const DEFAULT_ANTHROPIC_PROMPT_VERSION = "v2-structured";
const HEURISTIC_PROMPT_VERSION = "heuristic.v1";
const HEURISTIC_PROMPT_TEMPLATE_ID = "heuristic.rule_set.v1";
const OPENAI_COMPAT_PROMPT_TEMPLATE_ID = "openai_compat.chat_completions.json_object.v1";
const ANTHROPIC_PROMPT_TEMPLATE_ID = "anthropic.messages.tool_use.v1";

export interface AiSuggestionProviderAuditProfile {
  requestedMode: AiSuggestionProviderMode;
  provider: "heuristic" | "openai_compat" | "anthropic";
  fallbackProvider: "heuristic";
  promptTemplateId: string;
  promptVersion: string;
}

export interface AiSuggestionProviderBundle {
  provider: AiSuggestionProvider;
  auditProfile: AiSuggestionProviderAuditProfile;
}

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

  const normalized = raw.trim().toLowerCase();

  if (normalized === "openai_compat") {
    return "openai_compat";
  }

  if (normalized === "anthropic") {
    return "anthropic";
  }

  return "heuristic";
}

function createHeuristicAuditProfile(
  requestedMode: AiSuggestionProviderMode,
): AiSuggestionProviderAuditProfile {
  return {
    requestedMode,
    provider: "heuristic",
    fallbackProvider: "heuristic",
    promptTemplateId: HEURISTIC_PROMPT_TEMPLATE_ID,
    promptVersion: HEURISTIC_PROMPT_VERSION,
  };
}

function createOpenAiAuditProfile(input: {
  requestedMode: AiSuggestionProviderMode;
  promptVersion: string;
}): AiSuggestionProviderAuditProfile {
  return {
    requestedMode: input.requestedMode,
    provider: "openai_compat",
    fallbackProvider: "heuristic",
    promptTemplateId: OPENAI_COMPAT_PROMPT_TEMPLATE_ID,
    promptVersion: input.promptVersion,
  };
}

export function createAiSuggestionProviderBundle(input: FactoryInput = {}): AiSuggestionProviderBundle {
  const env = input.env ?? process.env;
  const logger = input.logger ?? console;
  const mode = resolveProviderMode(env[PROVIDER_MODE_ENV]);

  const heuristicPrimaryProvider = new HeuristicAiSuggestionProvider();
  const heuristicFallbackProvider = new HeuristicAiSuggestionProvider();

  const fallbackToHeuristicProvider = (): AiSuggestionProviderBundle => ({
    provider: new GuardrailedAiSuggestionProvider({
      providerName: "heuristic",
      provider: heuristicPrimaryProvider,
      fallbackProviderName: "heuristic",
      fallbackProvider: heuristicFallbackProvider,
      guardrailPolicy: readAiSuggestionGuardrailPolicy("heuristic", env),
    }),
    auditProfile: createHeuristicAuditProfile(mode),
  });

  if (mode === "anthropic") {
    const anthropicApiKey = env[ANTHROPIC_API_KEY_ENV]?.trim();

    if (!anthropicApiKey) {
      logger.warn("ai_suggestion_provider_config_fallback", {
        reason: "missing_anthropic_api_key",
        mode,
        missingEnv: ANTHROPIC_API_KEY_ENV,
      });
      return fallbackToHeuristicProvider();
    }

    const anthropicModel = env[ANTHROPIC_MODEL_ENV]?.trim() || DEFAULT_ANTHROPIC_MODEL;
    const promptVersion = env[PROMPT_VERSION_ENV]?.trim() || DEFAULT_ANTHROPIC_PROMPT_VERSION;
    const llmProvider = new LlmAiSuggestionProvider({
      promptVersion,
      client: new AnthropicAiSuggestionClient({
        apiKey: anthropicApiKey,
        model: anthropicModel,
        baseUrl: env[ANTHROPIC_BASE_URL_ENV]?.trim(),
        fetchFn: input.fetchFn,
      }),
    });

    return {
      provider: new GuardrailedAiSuggestionProvider({
        providerName: "anthropic",
        provider: llmProvider,
        fallbackProviderName: "heuristic",
        fallbackProvider: heuristicFallbackProvider,
        guardrailPolicy: readAiSuggestionGuardrailPolicy("anthropic", env),
      }),
      auditProfile: {
        requestedMode: mode,
        provider: "anthropic",
        fallbackProvider: "heuristic",
        promptTemplateId: ANTHROPIC_PROMPT_TEMPLATE_ID,
        promptVersion,
      },
    };
  }

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

  return {
    provider: new GuardrailedAiSuggestionProvider({
      providerName: "openai_compat",
      provider: llmProvider,
      fallbackProviderName: "heuristic",
      fallbackProvider: heuristicFallbackProvider,
      guardrailPolicy: readAiSuggestionGuardrailPolicy("openai_compat", env),
    }),
    auditProfile: createOpenAiAuditProfile({
      requestedMode: mode,
      promptVersion,
    }),
  };
}

export function createAiSuggestionProvider(input: FactoryInput = {}): AiSuggestionProvider {
  return createAiSuggestionProviderBundle(input).provider;
}
