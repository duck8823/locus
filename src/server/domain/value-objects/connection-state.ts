export interface PersistedConnectionState {
  provider: string;
  status: string;
  statusUpdatedAt: string;
  connectedAccountLabel: string | null;
}
