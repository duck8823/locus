import { listAllowedConnectionTransitions } from "@/server/domain/value-objects/connection-lifecycle-status";

export function listConnectionStateTransitions(currentStatus: string): string[] {
  return listAllowedConnectionTransitions(currentStatus);
}
