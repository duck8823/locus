"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SetConnectionStateUseCase } from "@/server/application/usecases/set-connection-state";
import { getDependencies } from "@/server/composition/dependencies";
import { assertWritableConnectionStatus } from "@/server/domain/value-objects/connection-lifecycle-status";
import { DEMO_VIEWER_COOKIE_NAME } from "@/server/presentation/actions/demo-viewer-cookie-name";
import { readRequiredString } from "@/server/presentation/actions/read-required-string";
import { resolveAuthenticatedReviewerId } from "@/server/presentation/actions/reviewer-identity";

const MAX_CONNECTED_ACCOUNT_LABEL_LENGTH = 200;

function readOptionalString(formData: FormData, name: string): string | null {
  const value = formData.get(name);

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > MAX_CONNECTED_ACCOUNT_LABEL_LENGTH) {
    throw new Error(`connectedAccountLabel must be at most ${MAX_CONNECTED_ACCOUNT_LABEL_LENGTH} characters`);
  }

  return trimmed;
}

function assertRelativeRedirectPath(value: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    throw new Error(`Invalid redirectPath: ${value}`);
  }

  return value;
}

export async function setConnectionStateAction(formData: FormData): Promise<void> {
  const cookieStore = await cookies();
  const { reviewerId } = await resolveAuthenticatedReviewerId(
    cookieStore.get(DEMO_VIEWER_COOKIE_NAME)?.value,
  );
  const provider = readRequiredString(formData, "provider");
  const nextStatus = assertWritableConnectionStatus(readRequiredString(formData, "nextStatus"));
  const redirectPath = assertRelativeRedirectPath(
    readRequiredString(formData, "redirectPath"),
  );
  const connectedAccountLabel = readOptionalString(formData, "connectedAccountLabel");
  const {
    connectionStateTransitionRepository,
    connectionProviderCatalog,
  } = getDependencies();
  const useCase = new SetConnectionStateUseCase({
    connectionStateTransitionRepository,
    connectionProviderCatalog,
  });

  await useCase.execute({
    reviewerId,
    provider,
    nextStatus,
    connectedAccountLabel,
    transitionReason: "manual",
    transitionActorType: "reviewer",
    transitionActorId: reviewerId,
  });

  revalidatePath(redirectPath);
  redirect(redirectPath);
}
