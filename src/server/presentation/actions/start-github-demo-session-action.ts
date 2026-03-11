"use server";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PrepareGitHubReviewWorkspaceUseCase } from "@/server/application/usecases/prepare-github-review-workspace";
import { getDependencies } from "@/server/composition/dependencies";
import {
  GitHubDemoActionError,
  toGitHubDemoErrorCode,
  type GitHubDemoErrorCode,
} from "./github-demo-error-code";
import { DEMO_VIEWER_COOKIE_NAME } from "./demo-viewer-cookie-name";
import { resolveDemoViewerName } from "./demo-viewer-name";
import { WORKSPACE_LOCALE_COOKIE_NAME } from "./workspace-locale-cookie-name";

function readTrimmedFormValue(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function readOptionalEnvironmentVariable(name: string): string {
  const value = process.env[name];
  return value?.trim() ?? "";
}

function readRequiredValue(params: {
  formData: FormData;
  formFieldName: string;
  envName: string;
  missingCode: GitHubDemoErrorCode;
}): string {
  const formValue = readTrimmedFormValue(params.formData, params.formFieldName);

  if (formValue.length > 0) {
    return formValue;
  }

  const envValue = readOptionalEnvironmentVariable(params.envName);

  if (envValue.length > 0) {
    return envValue;
  }

  throw new GitHubDemoActionError(params.missingCode);
}

function parsePullRequestNumber(rawValue: string): number {
  if (!/^\d+$/.test(rawValue)) {
    throw new GitHubDemoActionError("pull_request_number_invalid");
  }

  const pullRequestNumber = Number(rawValue);

  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new GitHubDemoActionError("pull_request_number_invalid");
  }

  return pullRequestNumber;
}

function normalizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

function createReviewId(owner: string, repository: string, pullRequestNumber: number): string {
  const normalizedOwner = normalizeSegment(owner) || "owner";
  const normalizedRepository = normalizeSegment(repository) || "repo";
  const canonicalOwner = owner.trim().toLowerCase();
  const canonicalRepository = repository.trim().toLowerCase();
  const discriminator = createHash("sha256")
    .update(`${canonicalOwner}\u0000${canonicalRepository}\u0000${pullRequestNumber}`)
    .digest("hex")
    .slice(0, 10);

  return `github-${normalizedOwner}-${normalizedRepository}-pr-${pullRequestNumber}-${discriminator}`;
}

export async function startGitHubDemoSessionAction(formData: FormData): Promise<void> {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const viewerName = resolveDemoViewerName({
    preferredLocale: cookieStore.get(WORKSPACE_LOCALE_COOKIE_NAME)?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });
  let redirectPath = "/";

  try {
    const owner = readRequiredValue({
      formData,
      formFieldName: "owner",
      envName: "LOCUS_GITHUB_DEMO_OWNER",
      missingCode: "owner_required",
    });
    const repository = readRequiredValue({
      formData,
      formFieldName: "repository",
      envName: "LOCUS_GITHUB_DEMO_REPO",
      missingCode: "repository_required",
    });
    const pullRequestNumberRaw = readRequiredValue({
      formData,
      formFieldName: "pullRequestNumber",
      envName: "LOCUS_GITHUB_DEMO_PR_NUMBER",
      missingCode: "pull_request_number_required",
    });
    const pullRequestNumber = parsePullRequestNumber(pullRequestNumberRaw);
    const reviewId = createReviewId(owner, repository, pullRequestNumber);
    const { reviewSessionRepository, analysisJobScheduler } = getDependencies();
    const prepareUseCase = new PrepareGitHubReviewWorkspaceUseCase({
      reviewSessionRepository,
    });
    const prepared = await prepareUseCase.execute({
      reviewId,
      viewerName,
      owner,
      repository,
      pullRequestNumber,
    });

    if (prepared.shouldStartIngestion) {
      const requestedAt = prepared.reviewSession.toRecord().analysisRequestedAt ?? new Date().toISOString();
      await analysisJobScheduler.scheduleReviewAnalysis({
        reviewId,
        requestedAt,
        reason: "initial_ingestion",
      });
    }

    cookieStore.set(DEMO_VIEWER_COOKIE_NAME, viewerName, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    revalidatePath(`/reviews/${reviewId}`);
    redirectPath = `/reviews/${reviewId}`;
  } catch (error) {
    const errorCode = toGitHubDemoErrorCode(error);
    redirectPath = `/?githubDemoErrorCode=${encodeURIComponent(errorCode)}`;
  }

  redirect(redirectPath);
}
