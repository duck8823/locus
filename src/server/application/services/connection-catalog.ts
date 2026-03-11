import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";

export type ConnectionProviderKey = "github" | "confluence" | "jira";

export type ConnectionStatus =
  | "not_connected"
  | "planned"
  | "connected"
  | "reauth_required";

export interface ConnectionCapabilities {
  supportsWebhook: boolean;
  supportsIssueContext: boolean;
}

export interface ConnectionCatalogEntry {
  provider: ConnectionProviderKey;
  status: ConnectionStatus;
  authMode: "oauth" | "none";
  capabilities: ConnectionCapabilities;
}

const prototypeConnectionCatalog: readonly ConnectionCatalogEntry[] = [
  {
    provider: "github",
    status: "not_connected",
    authMode: "oauth",
    capabilities: {
      supportsWebhook: true,
      supportsIssueContext: true,
    },
  },
  {
    provider: "confluence",
    status: "planned",
    authMode: "oauth",
    capabilities: {
      supportsWebhook: false,
      supportsIssueContext: true,
    },
  },
  {
    provider: "jira",
    status: "planned",
    authMode: "oauth",
    capabilities: {
      supportsWebhook: false,
      supportsIssueContext: true,
    },
  },
];

function cloneCatalogEntry(entry: ConnectionCatalogEntry): ConnectionCatalogEntry {
  return {
    ...entry,
    capabilities: { ...entry.capabilities },
  };
}

export class PrototypeConnectionProviderCatalog implements ConnectionProviderCatalog {
  listProviders(): ConnectionCatalogEntry[] {
    return prototypeConnectionCatalog.map(cloneCatalogEntry);
  }
}

const defaultPrototypeConnectionProviderCatalog = new PrototypeConnectionProviderCatalog();

export function listPrototypeConnectionCatalog(): ConnectionCatalogEntry[] {
  return defaultPrototypeConnectionProviderCatalog.listProviders();
}
