import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ReviewSession, type ReviewSessionRecord } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";

export interface FileReviewSessionRepositoryOptions {
  dataDirectory?: string;
}

export class FileReviewSessionRepository implements ReviewSessionRepository {
  private readonly dataDirectory: string;

  constructor(options: FileReviewSessionRepositoryOptions = {}) {
    this.dataDirectory = options.dataDirectory ?? path.join(process.cwd(), ".locus-data", "review-sessions");
  }

  async findByReviewId(reviewId: string): Promise<ReviewSession | null> {
    const filePath = this.getFilePath(reviewId);

    try {
      const raw = await readFile(filePath, "utf8");
      const record = JSON.parse(raw) as ReviewSessionRecord;
      return ReviewSession.fromRecord(record);
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw error;
    }
  }

  async save(reviewSession: ReviewSession): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    await writeFile(this.getFilePath(reviewSession.reviewId), JSON.stringify(reviewSession.toRecord(), null, 2));
  }

  private getFilePath(reviewId: string): string {
    return path.join(this.dataDirectory, `${encodeURIComponent(reviewId)}.json`);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
