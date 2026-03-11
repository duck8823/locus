import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";

interface ConnectionStateFileRecord {
  reviewerId?: string;
  connections?: PersistedConnectionState[];
}

export interface FileConnectionStateRepositoryOptions {
  dataDirectory?: string;
}

export class FileConnectionStateRepository implements ConnectionStateRepository {
  private readonly dataDirectory: string;

  constructor(options: FileConnectionStateRepositoryOptions = {}) {
    this.dataDirectory = options.dataDirectory ?? path.join(process.cwd(), ".locus-data", "connection-states");
  }

  async findByReviewerId(reviewerId: string): Promise<PersistedConnectionState[]> {
    const filePath = path.join(this.dataDirectory, `${encodeURIComponent(reviewerId)}.json`);

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as ConnectionStateFileRecord;
      const connections = parsed.connections;

      if (!Array.isArray(connections)) {
        return [];
      }

      return connections
        .filter((connection) => isNonEmptyString(connection?.provider))
        .map((connection) => ({
          provider: connection.provider,
          status: normalizeStatus(connection.status),
          statusUpdatedAt: normalizeStatusUpdatedAt(connection.statusUpdatedAt),
          connectedAccountLabel: normalizeConnectedAccountLabel(connection.connectedAccountLabel),
        }));
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }
}

function normalizeStatus(status: unknown): string {
  if (!isNonEmptyString(status)) {
    return "not_connected";
  }

  return status;
}

function normalizeStatusUpdatedAt(statusUpdatedAt: unknown): string {
  if (!isNonEmptyString(statusUpdatedAt)) {
    return new Date(0).toISOString();
  }

  return statusUpdatedAt;
}

function normalizeConnectedAccountLabel(connectedAccountLabel: unknown): string | null {
  if (typeof connectedAccountLabel !== "string") {
    return null;
  }

  const trimmed = connectedAccountLabel.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
