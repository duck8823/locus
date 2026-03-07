"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ReanalyzeReviewUseCase } from "@/server/application/usecases/reanalyze-review";
import { getDependencies } from "@/server/composition/dependencies";

export async function requestReanalysisAction(formData: FormData): Promise<void> {
  const reviewId = readRequiredString(formData, "reviewId");
  const { reviewSessionRepository, analysisJobScheduler } = getDependencies();
  const useCase = new ReanalyzeReviewUseCase({
    reviewSessionRepository,
    analysisJobScheduler,
  });

  await useCase.execute({ reviewId });
  revalidatePath(`/reviews/${reviewId}`);
  redirect(`/reviews/${reviewId}`);
}

function readRequiredString(formData: FormData, key: string): string {
  const value = formData.get(key);

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required.`);
  }

  return value;
}
