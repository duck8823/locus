export interface PersistedConnectionState {
  provider: string;
  status: string;
  statusUpdatedAt: string | null;
  connectedAccountLabel: string | null;
}
