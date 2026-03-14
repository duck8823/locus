import type { BusinessContextSnapshot } from "@/server/application/ports/business-context-provider";
import type { IntegrationFailureReasonCode } from "@/server/application/services/classify-integration-failure";

export class LiveBusinessContextUnavailableError extends Error {
  readonly fallbackSnapshot: BusinessContextSnapshot;
  readonly cacheHit: boolean | null;
  readonly fallbackReason: "stale_cache" | "live_fetch_failed" | null;
  readonly retryable: boolean;
  readonly reasonCode: IntegrationFailureReasonCode | null;

  constructor(input: {
    message?: string;
    fallbackSnapshot: BusinessContextSnapshot;
    cacheHit?: boolean | null;
    fallbackReason?: "stale_cache" | "live_fetch_failed" | null;
    retryable?: boolean;
    reasonCode?: IntegrationFailureReasonCode | null;
    cause?: unknown;
  }) {
    super(input.message ?? "Live business-context provider is temporarily unavailable.");
    this.name = "LiveBusinessContextUnavailableError";
    this.fallbackSnapshot = input.fallbackSnapshot;
    this.cacheHit = input.cacheHit ?? input.fallbackSnapshot.diagnostics.cacheHit ?? null;
    this.fallbackReason =
      input.fallbackReason ?? input.fallbackSnapshot.diagnostics.fallbackReason ?? null;
    this.retryable = input.retryable ?? true;
    this.reasonCode = input.reasonCode ?? null;
    this.cause = input.cause;
  }
}
