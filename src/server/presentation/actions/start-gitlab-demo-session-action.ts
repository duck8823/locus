"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PrepareGitLabReviewWorkspaceUseCase } from "@/server/application/usecases/prepare-gitlab-review-workspace";
import { getDependencies } from "@/server/composition/dependencies";
import { createGitLabDemoReviewId } from "./create-gitlab-demo-review-id";
import {
  GitLabDemoActionError,
  toGitLabDemoErrorCode,
  type GitLabDemoErrorCode,
} from "./gitlab-demo-error-code";
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
  missingCode: GitLabDemoErrorCode;
}): string {
  const formValue = readTrimmedFormValue(params.formData, params.formFieldName);

  if (formValue.length > 0) {
    return formValue;
  }

  const envValue = readOptionalEnvironmentVariable(params.envName);

  if (envValue.length > 0) {
    return envValue;
  }

  throw new GitLabDemoActionError(params.missingCode);
}

function parseMergeRequestIid(rawValue: string): number {
  if (!/^\d+$/.test(rawValue)) {
    throw new GitLabDemoActionError("merge_request_iid_invalid");
  }

  const mergeRequestIid = Number(rawValue);

  if (!Number.isInteger(mergeRequestIid) || mergeRequestIid <= 0) {
    throw new GitLabDemoActionError("merge_request_iid_invalid");
  }

  return mergeRequestIid;
}

export async function startGitLabDemoSessionAction(formData: FormData): Promise<void> {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const viewerName = resolveDemoViewerName({
    preferredLocale: cookieStore.get(WORKSPACE_LOCALE_COOKIE_NAME)?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });
  let redirectPath = "/";

  try {
    const projectPath = readRequiredValue({
      formData,
      formFieldName: "projectPath",
      envName: "LOCUS_GITLAB_DEMO_PROJECT_PATH",
      missingCode: "project_path_required",
    });
    const mergeRequestIidRaw = readRequiredValue({
      formData,
      formFieldName: "mergeRequestIid",
      envName: "LOCUS_GITLAB_DEMO_MERGE_REQUEST_IID",
      missingCode: "merge_request_iid_required",
    });
    const mergeRequestIid = parseMergeRequestIid(mergeRequestIidRaw);
    const reviewId = createGitLabDemoReviewId(projectPath, mergeRequestIid);
    const { reviewSessionRepository, analysisJobScheduler } = getDependencies();
    const prepareUseCase = new PrepareGitLabReviewWorkspaceUseCase({
      reviewSessionRepository,
    });
    const prepared = await prepareUseCase.execute({
      reviewId,
      viewerName,
      projectPath,
      mergeRequestIid,
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
    const errorCode = toGitLabDemoErrorCode(error);
    redirectPath = `/?gitlabDemoErrorCode=${encodeURIComponent(errorCode)}`;
  }

  redirect(redirectPath);
}
