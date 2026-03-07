"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IngestGitHubPullRequestUseCase } from "@/server/application/usecases/ingest-github-pull-request";
import { getDependencies } from "@/server/composition/dependencies";

const demoViewerCookieName = "locus-demo-viewer";

function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be set to use the GitHub pull request demo.`);
  }

  return value.trim();
}

function createReviewId(owner: string, repository: string, pullRequestNumber: number): string {
  return `github-${owner}-${repository}-pr-${pullRequestNumber}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, "-");
}

export async function startGitHubDemoSessionAction(): Promise<void> {
  const owner = readRequiredEnvironmentVariable("LOCUS_GITHUB_DEMO_OWNER");
  const repository = readRequiredEnvironmentVariable("LOCUS_GITHUB_DEMO_REPO");
  const pullRequestNumberRaw = readRequiredEnvironmentVariable("LOCUS_GITHUB_DEMO_PR_NUMBER");
  const pullRequestNumber = Number.parseInt(pullRequestNumberRaw, 10);

  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new Error("LOCUS_GITHUB_DEMO_PR_NUMBER must be a positive integer.");
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
