import type { ConnectionCatalogEntry } from "@/server/application/services/connection-catalog";

export interface ConnectionProviderCatalog {
  listProviders(): ConnectionCatalogEntry[];
}
