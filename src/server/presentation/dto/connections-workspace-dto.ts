import type {
  ConnectionCapabilities,
  ConnectionProviderKey,
} from "@/server/application/services/connection-catalog";

export interface ConnectionsWorkspaceTransitionDto {
  transitionId: string;
  previousStatus: string;
  nextStatus: string;
  changedAt: string;
  reason: "manual" | "token-expired" | "webhook";
  actorType: "reviewer" | "system";
  actorId: string | null;
  connectedAccountLabel: string | null;
}

export interface ConnectionsWorkspaceConnectionDto {
  provider: ConnectionProviderKey | string;
  status: string;
  authMode: "oauth" | "none" | string;
  statusUpdatedAt: string | null;
  connectedAccountLabel: string | null;
  stateSource: "catalog_default" | "persisted";
  capabilities: ConnectionCapabilities;
  recentTransitions: ConnectionsWorkspaceTransitionDto[];
  recentTransitionsTotalCount: number;
  recentTransitionsHasMore: boolean;
}

export interface ConnectionsWorkspaceDto {
  generatedAt: string;
  connections: ConnectionsWorkspaceConnectionDto[];
}
