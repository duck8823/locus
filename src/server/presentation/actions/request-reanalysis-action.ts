"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ReanalyzeReviewUseCase } from "@/server/application/usecases/reanalyze-review";
import { getDependencies } from "@/server/composition/dependencies";
import { readRequiredString } from "@/server/presentation/actions/read-required-string";

export async function requestReanalysisAction(formData: FormData): Promise<void> {
  const reviewId = readRequiredString(formData, "reviewId");
  const { reviewSessionRepository, parserAdapters, pullRequestSnapshotProvider } = getDependencies();
  const useCase = new ReanalyzeReviewUseCase({
    reviewSessionRepository,
    parserAdapters,
    pullRequestSnapshotProvider,
  });

  await useCase.execute({ reviewId });
  revalidatePath(`/reviews/${reviewId}`);
  redirect(`/reviews/${reviewId}`);
}
