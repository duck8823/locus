export const CONNECTION_STATE_TRANSITION_REASONS = [
  "manual",
  "token-expired",
  "webhook",
] as const;

export type ConnectionStateTransitionReason =
  (typeof CONNECTION_STATE_TRANSITION_REASONS)[number];

export const CONNECTION_STATE_TRANSITION_ACTOR_TYPES = [
  "reviewer",
  "system",
] as const;

export type ConnectionStateTransitionActorType =
  (typeof CONNECTION_STATE_TRANSITION_ACTOR_TYPES)[number];

export interface PersistedConnectionStateTransition {
  transitionId: string;
  reviewerId: string;
  provider: string;
  previousStatus: string;
  nextStatus: string;
  changedAt: string;
  reason: ConnectionStateTransitionReason;
  actorType: ConnectionStateTransitionActorType;
  actorId: string | null;
  connectedAccountLabel: string | null;
}

export type PersistedConnectionStateTransitionDraft = Omit<
  PersistedConnectionStateTransition,
  "transitionId"
>;
