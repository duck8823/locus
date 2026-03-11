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

const prototypeConnectionCatalog: ConnectionCatalogEntry[] = [
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

export function listPrototypeConnectionCatalog(): ConnectionCatalogEntry[] {
  return prototypeConnectionCatalog.map((entry) => ({ ...entry }));
}
