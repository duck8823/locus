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
