export type ConnectionProviderKey = "github" | "confluence" | "jira";

export type ConnectionStatus = "not_connected" | "planned";

export interface ConnectionCatalogEntry {
  provider: ConnectionProviderKey;
  status: ConnectionStatus;
  authMode: "oauth" | "none";
}

const prototypeConnectionCatalog: ConnectionCatalogEntry[] = [
  {
    provider: "github",
    status: "not_connected",
    authMode: "oauth",
  },
  {
    provider: "confluence",
    status: "planned",
    authMode: "oauth",
  },
  {
    provider: "jira",
    status: "planned",
    authMode: "oauth",
  },
];

export function listPrototypeConnectionCatalog(): ConnectionCatalogEntry[] {
  return prototypeConnectionCatalog.map((entry) => ({ ...entry }));
}
