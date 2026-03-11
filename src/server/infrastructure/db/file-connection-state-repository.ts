import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";

interface ConnectionStateFileRecord {
  reviewerId?: string;
  connections?: unknown;
}

export interface FileConnectionStateRepositoryOptions {
  dataDirectory?: string;
}

export class FileConnectionStateRepository implements ConnectionStateRepository {
  private readonly dataDirectory: string;
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(options: FileConnectionStateRepositoryOptions = {}) {
    this.dataDirectory = options.dataDirectory ?? path.join(process.cwd(), ".locus-data", "connection-states");
  }

  async findByReviewerId(reviewerId: string): Promise<PersistedConnectionState[]> {
    return this.readStatesForReviewerId(reviewerId);
  }

  async saveForReviewerId(
    reviewerId: string,
    states: PersistedConnectionState[],
  ): Promise<void> {
    await this.updateForReviewerId(reviewerId, () => states);
  }

  async updateForReviewerId(
    reviewerId: string,
    updater: (states: PersistedConnectionState[]) => PersistedConnectionState[],
  ): Promise<PersistedConnectionState[]> {
    let savedStates: PersistedConnectionState[] = [];

    await this.enqueueWrite(reviewerId, async () => {
      const currentStates = await this.readStatesForReviewerId(reviewerId);
      const nextStates = updater(currentStates);
      savedStates = normalizeStates(nextStates);
      await this.writeStatesForReviewerId(reviewerId, savedStates);
    });

    return savedStates;
  }

  private getFilePath(reviewerId: string): string {
    return path.join(this.dataDirectory, `${encodeURIComponent(reviewerId)}.json`);
  }

  private async readStatesForReviewerId(reviewerId: string): Promise<PersistedConnectionState[]> {
    const filePath = this.getFilePath(reviewerId);

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = parseConnectionStateFile(raw);

      if (!parsed || !Array.isArray(parsed.connections)) {
        return [];
      }

      return normalizeStates(parsed.connections);
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  private async writeStatesForReviewerId(
    reviewerId: string,
    states: PersistedConnectionState[],
  ): Promise<void> {
    const content = JSON.stringify(
      {
        reviewerId,
        connections: states,
      },
      null,
      2,
    );

    await mkdir(this.dataDirectory, { recursive: true });

    const filePath = this.getFilePath(reviewerId);
    const tempFilePath = `${filePath}.${randomUUID()}.tmp`;

    await writeFile(tempFilePath, content);
    await rename(tempFilePath, filePath);
  }

  private async enqueueWrite(
    reviewerId: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const previousWrite = this.writeQueues.get(reviewerId) ?? Promise.resolve();
    const nextWrite = previousWrite.catch(() => undefined).then(action);

    this.writeQueues.set(reviewerId, nextWrite);

    try {
      await nextWrite;
    } finally {
      if (this.writeQueues.get(reviewerId) === nextWrite) {
        this.writeQueues.delete(reviewerId);
      }
    }
  }
}

function parseConnectionStateFile(raw: string): ConnectionStateFileRecord | null {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!isPlainObject(parsed)) {
      return null;
    }

    return parsed as ConnectionStateFileRecord;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}

function normalizeConnectionStateRecord(record: unknown): PersistedConnectionState | null {
  if (!isPlainObject(record)) {
    return null;
  }

  const provider = normalizeProvider(record.provider);

  if (!provider) {
    return null;
  }

  return {
    provider,
    status: normalizeStatus(record.status),
    statusUpdatedAt: normalizeStatusUpdatedAt(record.statusUpdatedAt),
    connectedAccountLabel: normalizeConnectedAccountLabel(record.connectedAccountLabel),
  };
}

function normalizeStates(records: unknown[]): PersistedConnectionState[] {
  return records.flatMap((record) => {
    const normalized = normalizeConnectionStateRecord(record);
    return normalized ? [normalized] : [];
  });
}

function normalizeProvider(provider: unknown): string | null {
  if (!isNonEmptyString(provider)) {
    return null;
  }

  const normalized = provider.trim();

  if (normalized.length > 120) {
    return null;
  }

  return normalized;
}

function normalizeStatus(status: unknown): string {
  if (!isNonEmptyString(status)) {
    return "not_connected";
  }

  return status.trim();
}

function normalizeStatusUpdatedAt(statusUpdatedAt: unknown): string | null {
  if (!isNonEmptyString(statusUpdatedAt)) {
    return null;
  }

  const epochMs = Date.parse(statusUpdatedAt);

  if (Number.isNaN(epochMs)) {
    return null;
  }

  return new Date(epochMs).toISOString();
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
