"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RequestInitialAnalysisRetryUseCase } from "@/server/application/usecases/request-initial-analysis-retry";
import { getDependencies } from "@/server/composition/dependencies";
import { readRequiredString } from "@/server/presentation/actions/read-required-string";
import { toWorkspaceErrorCode } from "@/server/presentation/actions/workspace-error-code";

export async function requestInitialAnalysisRetryAction(formData: FormData): Promise<void> {
  const reviewId = readRequiredString(formData, "reviewId");
  const { reviewSessionRepository, analysisJobScheduler } = getDependencies();
  const useCase = new RequestInitialAnalysisRetryUseCase({
    reviewSessionRepository,
    analysisJobScheduler,
  });

  try {
    await useCase.execute({ reviewId });
    revalidatePath(`/reviews/${reviewId}`);
    redirect(`/reviews/${reviewId}`);
  } catch (error) {
    const query = new URLSearchParams({
      workspaceError: toWorkspaceErrorCode(error),
    });
    redirect(`/reviews/${reviewId}?${query.toString()}`);
  }
}
