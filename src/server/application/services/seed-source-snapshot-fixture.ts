import type { SourceSnapshotPair } from "@/server/domain/value-objects/source-snapshot";

function createSnapshotId(reviewId: string, fileId: string, revision: "before" | "after") {
  return `${reviewId}:${fileId}:${revision}`;
}

export function createSeedSourceSnapshotPairs(reviewId: string): SourceSnapshotPair[] {
  return [
    {
      fileId: "file-user-service",
      filePath: "src/core/user-service.ts",
      before: {
        snapshotId: createSnapshotId(reviewId, "file-user-service", "before"),
        fileId: "file-user-service",
        filePath: "src/core/user-service.ts",
        language: "typescript",
        revision: "before",
        content: `
export class UserService {
  updateProfile = (input: { email: string; phone: string }) => {
    const normalizedEmail = input.email.trim().toLowerCase();

    return {
      email: normalizedEmail,
    };
  };
}

export function formatPhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}
`.trim(),
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: "pull/seed",
        },
      },
      after: {
        snapshotId: createSnapshotId(reviewId, "file-user-service", "after"),
        fileId: "file-user-service",
        filePath: "src/core/user-service.ts",
        language: "typescript",
        revision: "after",
        content: `
export class UserService {
  updateProfile = (input: { email: string; phone: string }) => {
    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedPhone = formatPhone(input.phone);

    return {
      email: normalizedEmail,
      phone: normalizedPhone,
    };
  };
}

export function formatPhone(phone: string): string {
  // Keep only numeric characters.
  return phone.replace(/[^0-9]/g, "");
}
`.trim(),
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: "pull/seed",
        },
      },
    },
    {
      fileId: "file-email-validator",
      filePath: "src/core/email-validator.ts",
      before: {
        snapshotId: createSnapshotId(reviewId, "file-email-validator", "before"),
        fileId: "file-email-validator",
        filePath: "src/core/email-validator.ts",
        language: "typescript",
        revision: "before",
        content: `
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isLegacyDomain(email: string): boolean {
  return email.endsWith("@legacy.example.com");
}
`.trim(),
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: "pull/seed",
        },
      },
      after: {
        snapshotId: createSnapshotId(reviewId, "file-email-validator", "after"),
        fileId: "file-email-validator",
        filePath: "src/core/email-validator.ts",
        language: "typescript",
        revision: "after",
        content: `
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validatePhone(phone: string): boolean {
  return /^\\+?[0-9]{10,15}$/.test(phone);
}
`.trim(),
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: "pull/seed",
        },
      },
    },
    {
      fileId: "file-rules-md",
      filePath: "docs/review-rules.md",
      before: {
        snapshotId: createSnapshotId(reviewId, "file-rules-md", "before"),
        fileId: "file-rules-md",
        filePath: "docs/review-rules.md",
        language: "markdown",
        revision: "before",
        content: "# Review Rules\n\n- Keep PRs small.",
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: "pull/seed",
        },
      },
      after: {
        snapshotId: createSnapshotId(reviewId, "file-rules-md", "after"),
        fileId: "file-rules-md",
        filePath: "docs/review-rules.md",
        language: "markdown",
        revision: "after",
        content: "# Review Rules\n\n- Keep PRs small.\n- Prefer semantic diff.",
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: "pull/seed",
        },
      },
    },
  ];
}
