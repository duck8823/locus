import {
  listPrototypeConnectionCatalog,
  type ConnectionCatalogEntry,
} from "@/server/application/services/connection-catalog";

export interface GetConnectionsWorkspaceResult {
  connections: ConnectionCatalogEntry[];
}

export class GetConnectionsWorkspaceUseCase {
  async execute(): Promise<GetConnectionsWorkspaceResult> {
    return {
      connections: listPrototypeConnectionCatalog(),
    };
  }
}
