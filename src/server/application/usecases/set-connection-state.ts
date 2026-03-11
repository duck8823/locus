import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import {
  assertConnectionStatusTransition,
  type WritableConnectionStatus,
} from "@/server/domain/value-objects/connection-lifecycle-status";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";

export interface SetConnectionStateInput {
  reviewerId: string;
  provider: string;
  nextStatus: WritableConnectionStatus;
  connectedAccountLabel: string | null;
}

export interface SetConnectionStateDependencies {
  connectionStateRepository: ConnectionStateRepository;
  connectionProviderCatalog: ConnectionProviderCatalog;
}

export interface SetConnectionStateResult {
  provider: string;
  status: WritableConnectionStatus;
  statusUpdatedAt: string;
  connectedAccountLabel: string | null;
}

export class SetConnectionStateUseCase {
  constructor(private readonly dependencies: SetConnectionStateDependencies) {}

  async execute(input: SetConnectionStateInput): Promise<SetConnectionStateResult> {
    const providerEntry = this.dependencies.connectionProviderCatalog
      .listProviders()
      .find((provider) => provider.provider === input.provider);

    if (!providerEntry) {
      throw new Error(`Unsupported connection provider: ${input.provider}`);
    }

    const states = await this.dependencies.connectionStateRepository.findByReviewerId(input.reviewerId);
    const currentState = selectLatestProviderState(states, input.provider);
    const currentStatus = currentState?.status ?? providerEntry.status;

    assertConnectionStatusTransition(currentStatus, input.nextStatus);

    const statusUpdatedAt = new Date().toISOString();
    const nextState: PersistedConnectionState = {
      provider: input.provider,
      status: input.nextStatus,
      statusUpdatedAt,
      connectedAccountLabel: normalizeConnectedAccountLabel({
        current: currentState?.connectedAccountLabel ?? null,
        nextStatus: input.nextStatus,
        requested: input.connectedAccountLabel,
      }),
    };

    const remainingStates = states.filter((state) => state.provider !== input.provider);
    await this.dependencies.connectionStateRepository.saveForReviewerId(input.reviewerId, [
      ...remainingStates,
      nextState,
    ]);

    return {
      provider: nextState.provider,
      status: nextState.status as WritableConnectionStatus,
      statusUpdatedAt,
      connectedAccountLabel: nextState.connectedAccountLabel,
    };
  }
}

function selectLatestProviderState(
  states: PersistedConnectionState[],
  provider: string,
): PersistedConnectionState | null {
  const providerStates = states.filter((state) => state.provider === provider);

  if (providerStates.length === 0) {
    return null;
  }

  return providerStates.slice(1).reduce((latest, current) => {
    if (toEpochMs(latest.statusUpdatedAt) <= toEpochMs(current.statusUpdatedAt)) {
      return current;
    }

    return latest;
  }, providerStates[0]);
}

function toEpochMs(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return 0;
  }

  return parsed;
}

function normalizeConnectedAccountLabel(input: {
  current: string | null;
  requested: string | null;
  nextStatus: WritableConnectionStatus;
}): string | null {
  const requested = input.requested?.trim() ?? "";

  if (input.nextStatus === "not_connected") {
    return null;
  }

  if (input.nextStatus === "connected") {
    if (requested.length > 0) {
      return requested;
    }

    return input.current;
  }

  // reauth_required keeps the prior account identity when possible.
  if (requested.length > 0) {
    return requested;
  }

  return input.current;
}
