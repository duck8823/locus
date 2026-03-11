import type {
  ConnectionCapabilities,
  ConnectionProviderKey,
} from "@/server/application/services/connection-catalog";

export interface ConnectionsWorkspaceConnectionDto {
  provider: ConnectionProviderKey | string;
  status: string;
  authMode: "oauth" | "none" | string;
  statusUpdatedAt: string | null;
  connectedAccountLabel: string | null;
  stateSource: "catalog_default" | "persisted";
  capabilities: ConnectionCapabilities;
}

export interface ConnectionsWorkspaceDto {
  generatedAt: string;
  connections: ConnectionsWorkspaceConnectionDto[];
}
