import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";
import type {
  PersistedConnectionStateTransition,
  PersistedConnectionStateTransitionDraft,
} from "@/server/domain/value-objects/connection-state-transition";

export interface ListConnectionStateTransitionOptions {
  provider?: string;
  limit?: number;
}

export interface ConnectionStateTransitionRepository {
  appendTransition(
    transition: PersistedConnectionStateTransitionDraft,
  ): Promise<PersistedConnectionStateTransition>;
  listRecentByReviewerId(
    reviewerId: string,
    options?: ListConnectionStateTransitionOptions,
  ): Promise<PersistedConnectionStateTransition[]>;
}

export interface UpdateConnectionStateAndTransitionResult {
  states: PersistedConnectionState[];
  transition: PersistedConnectionStateTransition | null;
}

export interface ConnectionStateTransitionTransactionalRepository {
  updateStateAndAppendTransition(
    reviewerId: string,
    updater: (states: PersistedConnectionState[]) => {
      states: PersistedConnectionState[];
      transition: PersistedConnectionStateTransitionDraft | null;
    },
  ): Promise<UpdateConnectionStateAndTransitionResult>;
}

export function isConnectionStateTransitionTransactionalRepository(
  value: unknown,
): value is ConnectionStateTransitionRepository & ConnectionStateTransitionTransactionalRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    "updateStateAndAppendTransition" in value &&
    typeof value.updateStateAndAppendTransition === "function"
  );
}
