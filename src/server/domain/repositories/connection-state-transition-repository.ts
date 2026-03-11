import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";
import type {
  ConnectionStateTransitionReason,
  PersistedConnectionStateTransition,
  PersistedConnectionStateTransitionDraft,
} from "@/server/domain/value-objects/connection-state-transition";

export interface ListConnectionStateTransitionOptions {
  provider?: string;
  reason?: ConnectionStateTransitionReason;
  limit?: number;
  offset?: number;
}

export interface CountConnectionStateTransitionOptions {
  provider?: string;
  reason?: ConnectionStateTransitionReason;
}

export interface ConnectionStateTransitionRepository {
  appendTransition(
    transition: PersistedConnectionStateTransitionDraft,
  ): Promise<PersistedConnectionStateTransition>;
  listRecentByReviewerId(
    reviewerId: string,
    options?: ListConnectionStateTransitionOptions,
  ): Promise<PersistedConnectionStateTransition[]>;
  countByReviewerId(
    reviewerId: string,
    options?: CountConnectionStateTransitionOptions,
  ): Promise<number>;
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
