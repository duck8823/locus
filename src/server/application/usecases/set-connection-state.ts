import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";
import {
  type ConnectionStateTransitionTransactionalRepository,
  type ConnectionStateTransitionRepository,
} from "@/server/domain/repositories/connection-state-transition-repository";
import {
  assertConnectionStatusTransition,
  type WritableConnectionStatus,
} from "@/server/domain/value-objects/connection-lifecycle-status";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";
import type { PersistedConnectionStateTransitionDraft } from "@/server/domain/value-objects/connection-state-transition";

export interface SetConnectionStateInput {
  reviewerId: string;
  provider: string;
  nextStatus: WritableConnectionStatus;
  connectedAccountLabel: string | null;
}

export interface SetConnectionStateDependencies {
  connectionStateTransitionRepository: ConnectionStateTransitionRepository &
    ConnectionStateTransitionTransactionalRepository;
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

    const buildMutation = (
      states: PersistedConnectionState[],
    ): {
      states: PersistedConnectionState[];
      transition: PersistedConnectionStateTransitionDraft;
    } => {
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

      return {
        states: [...remainingStates, nextState],
        transition: {
          reviewerId: input.reviewerId,
          provider: input.provider,
          previousStatus: currentStatus,
          nextStatus: nextState.status,
          changedAt: statusUpdatedAt,
          connectedAccountLabel: nextState.connectedAccountLabel,
        },
      };
    };

    const result =
      await this.dependencies.connectionStateTransitionRepository.updateStateAndAppendTransition(
        input.reviewerId,
        (states) => buildMutation(states),
      );
    const savedStates = result.states;

    const nextState = selectLatestProviderState(savedStates, input.provider);

    if (!nextState) {
      throw new Error(`Failed to persist connection state for provider: ${input.provider}`);
    }

    if (!nextState.statusUpdatedAt) {
      throw new Error(`Persisted state is missing statusUpdatedAt for provider: ${input.provider}`);
    }

    return {
      provider: nextState.provider,
      status: nextState.status as WritableConnectionStatus,
      statusUpdatedAt: nextState.statusUpdatedAt,
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
