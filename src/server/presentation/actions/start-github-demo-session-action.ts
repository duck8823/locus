"use server";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IngestGitHubPullRequestUseCase } from "@/server/application/usecases/ingest-github-pull-request";
import { getDependencies } from "@/server/composition/dependencies";

const demoViewerCookieName = "locus-demo-viewer";

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
  label: string;
}): string {
  const formValue = readTrimmedFormValue(params.formData, params.formFieldName);

  if (formValue.length > 0) {
    return formValue;
  }

  const envValue = readOptionalEnvironmentVariable(params.envName);

  if (envValue.length > 0) {
    return envValue;
  }

  throw new Error(`${params.label} is required.`);
}

function parsePullRequestNumber(rawValue: string): number {
  if (!/^\d+$/.test(rawValue)) {
    throw new Error("GitHub pull request number must be a positive integer.");
  }

  const pullRequestNumber = Number(rawValue);

  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new Error("GitHub pull request number must be a positive integer.");
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
  const discriminator = createHash("sha256")
    .update(`${owner}\u0000${repository}\u0000${pullRequestNumber}`)
    .digest("hex")
    .slice(0, 10);

  return `github-${normalizedOwner}-${normalizedRepository}-pr-${pullRequestNumber}-${discriminator}`;
}

function createDemoErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "GitHub demo を開始できませんでした。";
  }

  if (error.message.includes("GitHub API request failed") || error.message.includes("timed out")) {
    return "GitHub PR の取得に失敗しました。owner/repository/PR number、レート制限、認証設定を確認してください。";
  }

  if (error.message.endsWith(" is required.") || error.message === "GitHub pull request number must be a positive integer.") {
    return error.message;
  }

  return "GitHub demo を開始できませんでした。入力値と設定を確認してください。";
}

export async function startGitHubDemoSessionAction(formData: FormData): Promise<void> {
  const viewerName = "Demo reviewer";
  let redirectPath = "/";

  try {
    const owner = readRequiredValue({
      formData,
      formFieldName: "owner",
      envName: "LOCUS_GITHUB_DEMO_OWNER",
      label: "GitHub owner",
    });
    const repository = readRequiredValue({
      formData,
      formFieldName: "repository",
      envName: "LOCUS_GITHUB_DEMO_REPO",
      label: "GitHub repository",
    });
    const pullRequestNumberRaw = readRequiredValue({
      formData,
      formFieldName: "pullRequestNumber",
      envName: "LOCUS_GITHUB_DEMO_PR_NUMBER",
      label: "GitHub pull request number",
    });
    const pullRequestNumber = parsePullRequestNumber(pullRequestNumberRaw);
    const reviewId = createReviewId(owner, repository, pullRequestNumber);

    const { reviewSessionRepository, parserAdapters, pullRequestSnapshotProvider } = getDependencies();
    const useCase = new IngestGitHubPullRequestUseCase({
      reviewSessionRepository,
      parserAdapters,
      pullRequestSnapshotProvider,
    });

    await useCase.execute({
      reviewId,
      viewerName,
      owner,
      repository,
      pullRequestNumber,
    });

    const cookieStore = await cookies();
    cookieStore.set(demoViewerCookieName, viewerName, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    revalidatePath(`/reviews/${reviewId}`);
    redirectPath = `/reviews/${reviewId}`;
  } catch (error) {
    const message = createDemoErrorMessage(error);
    redirectPath = `/?githubDemoError=${encodeURIComponent(message)}`;
  }

  redirect(redirectPath);
}
