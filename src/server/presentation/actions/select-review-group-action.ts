"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SelectReviewGroupUseCase } from "@/server/application/usecases/select-review-group";
import { getDependencies } from "@/server/composition/dependencies";
import { readRequiredString } from "@/server/presentation/actions/read-required-string";

export async function selectReviewGroupAction(formData: FormData): Promise<void> {
  const reviewId = readRequiredString(formData, "reviewId");
  const groupId = readRequiredString(formData, "groupId");
  const { reviewSessionRepository } = getDependencies();
  const useCase = new SelectReviewGroupUseCase({ reviewSessionRepository });

  await useCase.execute({ reviewId, groupId });
  revalidatePath(`/reviews/${reviewId}`);
  redirect(`/reviews/${reviewId}`);
}
