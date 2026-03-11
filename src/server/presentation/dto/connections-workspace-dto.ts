import type {
  ConnectionProviderKey,
  ConnectionStatus,
} from "@/server/application/services/connection-catalog";

export interface ConnectionsWorkspaceConnectionDto {
  provider: ConnectionProviderKey;
  status: ConnectionStatus;
  authMode: "oauth" | "none";
}

export interface ConnectionsWorkspaceDto {
  generatedAt: string;
  connections: ConnectionsWorkspaceConnectionDto[];
}
