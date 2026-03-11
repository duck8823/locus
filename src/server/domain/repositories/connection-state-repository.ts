import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";

export interface ConnectionStateRepository {
  findByReviewerId(reviewerId: string): Promise<PersistedConnectionState[]>;
}
