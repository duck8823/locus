import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type {
  OAuthStateRepository,
  PendingOAuthState,
  SavePendingOAuthStateInput,
} from "@/server/application/ports/oauth-state-repository";

interface OAuthStateStore {
  states?: unknown;
}

export interface FileOAuthStateRepositoryOptions {
  dataFilePath?: string;
}

export class FileOAuthStateRepository implements OAuthStateRepository {
  private readonly dataFilePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: FileOAuthStateRepositoryOptions = {}) {
    this.dataFilePath =
      options.dataFilePath ?? path.join(process.cwd(), ".locus-data", "oauth", "pending-states.json");
  }

  async savePendingState(input: SavePendingOAuthStateInput): Promise<PendingOAuthState> {
    const normalized = assertPendingOAuthState(input);

    await this.enqueueWrite(async () => {
      const current = await this.readPendingStates();
      const deduped = current.filter((state) => state.state !== normalized.state);
      await this.writePendingStates([...deduped, normalized]);
    });

    return normalized;
  }

  async consumePendingState(state: string): Promise<PendingOAuthState | null> {
    const normalizedState = state.trim();

    if (normalizedState.length === 0) {
      return null;
    }

    let consumed: PendingOAuthState | null = null;

    await this.enqueueWrite(async () => {
      const nowEpochMs = Date.now();
      const current = await this.readPendingStates();
      const next: PendingOAuthState[] = [];

      for (const pending of current) {
        const expiresAtEpochMs = Date.parse(pending.expiresAt);

        if (!Number.isFinite(expiresAtEpochMs) || expiresAtEpochMs <= nowEpochMs) {
          continue;
        }

        if (!consumed && pending.state === normalizedState) {
          consumed = pending;
          continue;
        }

        next.push(pending);
      }

      await this.writePendingStates(next);
    });

    return consumed;
  }

  private async readPendingStates(): Promise<PendingOAuthState[]> {
    try {
      const raw = await readFile(this.dataFilePath, "utf8");
      const parsed = JSON.parse(raw) as OAuthStateStore;

      if (!parsed || !Array.isArray(parsed.states)) {
        return [];
      }

      return parsed.states.flatMap((state) => {
        const normalized = normalizePendingOAuthState(state);
        return normalized ? [normalized] : [];
      });
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      if (error instanceof SyntaxError) {
        return [];
      }

      throw error;
    }
  }

  private async writePendingStates(states: PendingOAuthState[]): Promise<void> {
    await mkdir(path.dirname(this.dataFilePath), { recursive: true });
    const tempPath = `${this.dataFilePath}.${randomUUID()}.tmp`;
    await writeFile(
      tempPath,
      JSON.stringify(
        {
          states,
        },
        null,
        2,
      ),
    );
    await rename(tempPath, this.dataFilePath);
  }

  private async enqueueWrite(task: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.catch(() => undefined).then(task);
    this.writeQueue = next;
    await next;
  }
}

function normalizePendingOAuthState(value: unknown): PendingOAuthState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const state = normalizeString(record.state, 512);
  const reviewerId = normalizeString(record.reviewerId, 200);
  const redirectPath = normalizeString(record.redirectPath, 2000);
  const codeVerifier = normalizeString(record.codeVerifier, 512);
  const createdAt = normalizeIsoTimestamp(record.createdAt);
  const expiresAt = normalizeIsoTimestamp(record.expiresAt);

  if (
    !state ||
    !reviewerId ||
    !redirectPath ||
    !codeVerifier ||
    !createdAt ||
    !expiresAt
  ) {
    return null;
  }

  return {
    state,
    provider: "github",
    reviewerId,
    redirectPath,
    codeVerifier,
    createdAt,
    expiresAt,
  };
}

function assertPendingOAuthState(input: SavePendingOAuthStateInput): PendingOAuthState {
  const normalized = normalizePendingOAuthState(input);

  if (!normalized) {
    throw new Error("Invalid pending OAuth state input.");
  }

  return normalized;
}

function normalizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }

  return trimmed;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const epochMs = Date.parse(value);

  if (!Number.isFinite(epochMs)) {
    return null;
  }

  return new Date(epochMs).toISOString();
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
