"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RequestManualReanalysisUseCase } from "@/server/application/usecases/request-manual-reanalysis";
import { getDependencies } from "@/server/composition/dependencies";
import { readRequiredString } from "@/server/presentation/actions/read-required-string";

export async function requestReanalysisAction(formData: FormData): Promise<void> {
  const reviewId = readRequiredString(formData, "reviewId");
  const { reviewSessionRepository, analysisJobScheduler } = getDependencies();
  const useCase = new RequestManualReanalysisUseCase({
    reviewSessionRepository,
    analysisJobScheduler,
  });

  await useCase.execute({ reviewId });
  revalidatePath(`/reviews/${reviewId}`);
  redirect(`/reviews/${reviewId}`);
}
