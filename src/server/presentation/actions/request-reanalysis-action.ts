"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RequestManualReanalysisUseCase } from "@/server/application/usecases/request-manual-reanalysis";
import { getDependencies } from "@/server/composition/dependencies";
import { readRequiredString } from "@/server/presentation/actions/read-required-string";
import { toWorkspaceErrorCode } from "@/server/presentation/actions/workspace-error-code";

export async function requestReanalysisAction(formData: FormData): Promise<void> {
  const reviewId = readRequiredString(formData, "reviewId");
  const { reviewSessionRepository, analysisJobScheduler } = getDependencies();
  const useCase = new RequestManualReanalysisUseCase({
    reviewSessionRepository,
    analysisJobScheduler,
  });
  let workspaceErrorCode: string | null = null;

  try {
    await useCase.execute({ reviewId });
  } catch (error) {
    workspaceErrorCode = toWorkspaceErrorCode(error);
  }

  revalidatePath(`/reviews/${reviewId}`);

  if (workspaceErrorCode) {
    const query = new URLSearchParams({
      workspaceError: workspaceErrorCode,
    });
    redirect(`/reviews/${reviewId}?${query.toString()}`);
  }

  redirect(`/reviews/${reviewId}`);
}
