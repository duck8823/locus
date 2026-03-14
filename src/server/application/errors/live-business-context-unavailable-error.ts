import type { BusinessContextSnapshot } from "@/server/application/ports/business-context-provider";

export class LiveBusinessContextUnavailableError extends Error {
  readonly fallbackSnapshot: BusinessContextSnapshot;
  readonly cacheHit: boolean | null;
  readonly fallbackReason: "stale_cache" | "live_fetch_failed" | null;

  constructor(input: {
    message?: string;
    fallbackSnapshot: BusinessContextSnapshot;
    cacheHit?: boolean | null;
    fallbackReason?: "stale_cache" | "live_fetch_failed" | null;
    cause?: unknown;
  }) {
    super(input.message ?? "Live business-context provider is temporarily unavailable.");
    this.name = "LiveBusinessContextUnavailableError";
    this.fallbackSnapshot = input.fallbackSnapshot;
    this.cacheHit = input.cacheHit ?? input.fallbackSnapshot.diagnostics.cacheHit ?? null;
    this.fallbackReason =
      input.fallbackReason ?? input.fallbackSnapshot.diagnostics.fallbackReason ?? null;
    this.cause = input.cause;
  }
}
