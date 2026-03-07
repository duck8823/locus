"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MarkReviewGroupStatusUseCase } from "@/server/application/usecases/mark-review-group-status";
import { getDependencies } from "@/server/composition/dependencies";
import { assertReviewGroupStatus } from "@/server/domain/value-objects/review-status";

export async function setReviewGroupStatusAction(formData: FormData): Promise<void> {
  const reviewId = readRequiredString(formData, "reviewId");
  const groupId = readRequiredString(formData, "groupId");
  const status = assertReviewGroupStatus(readRequiredString(formData, "status"));
  const { reviewSessionRepository } = getDependencies();
  const useCase = new MarkReviewGroupStatusUseCase({ reviewSessionRepository });

  await useCase.execute({ reviewId, groupId, status });
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
