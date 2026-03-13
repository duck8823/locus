import type { BusinessContextSnapshot } from "@/server/application/ports/business-context-provider";

export class LiveBusinessContextUnavailableError extends Error {
  readonly fallbackSnapshot: BusinessContextSnapshot;

  constructor(input: {
    message?: string;
    fallbackSnapshot: BusinessContextSnapshot;
    cause?: unknown;
  }) {
    super(input.message ?? "Live business-context provider is temporarily unavailable.");
    this.name = "LiveBusinessContextUnavailableError";
    this.fallbackSnapshot = input.fallbackSnapshot;
    this.cause = input.cause;
  }
}
