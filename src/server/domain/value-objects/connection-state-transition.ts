export interface PersistedConnectionStateTransition {
  transitionId: string;
  reviewerId: string;
  provider: string;
  previousStatus: string;
  nextStatus: string;
  changedAt: string;
  connectedAccountLabel: string | null;
}

export type PersistedConnectionStateTransitionDraft = Omit<
  PersistedConnectionStateTransition,
  "transitionId"
>;
