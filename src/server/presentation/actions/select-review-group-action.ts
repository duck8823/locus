"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SelectReviewGroupUseCase } from "@/server/application/usecases/select-review-group";
import { getDependencies } from "@/server/composition/dependencies";

export async function selectReviewGroupAction(formData: FormData): Promise<void> {
  const reviewId = readRequiredString(formData, "reviewId");
  const groupId = readRequiredString(formData, "groupId");
  const { reviewSessionRepository } = getDependencies();
  const useCase = new SelectReviewGroupUseCase({ reviewSessionRepository });

  await useCase.execute({ reviewId, groupId });
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
