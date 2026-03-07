"use server";

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

function createReviewId(owner: string, repository: string, pullRequestNumber: number): string {
  return `github-${owner}-${repository}-pr-${pullRequestNumber}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, "-");
}

export async function startGitHubDemoSessionAction(formData: FormData): Promise<void> {
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
  const pullRequestNumber = Number.parseInt(pullRequestNumberRaw, 10);

  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new Error("GitHub pull request number must be a positive integer.");
  }

  const viewerName = "Demo reviewer";
  const cookieStore = await cookies();

  cookieStore.set(demoViewerCookieName, viewerName, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

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

  revalidatePath(`/reviews/${reviewId}`);
  redirect(`/reviews/${reviewId}`);
}
