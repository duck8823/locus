"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SetConnectionStateUseCase } from "@/server/application/usecases/set-connection-state";
import { getDependencies } from "@/server/composition/dependencies";
import { assertWritableConnectionStatus } from "@/server/domain/value-objects/connection-lifecycle-status";
import { readRequiredString } from "@/server/presentation/actions/read-required-string";

function readOptionalString(formData: FormData, name: string): string | null {
  const value = formData.get(name);

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  const reviewerId = readRequiredString(formData, "reviewerId");
  const provider = readRequiredString(formData, "provider");
  const nextStatus = assertWritableConnectionStatus(readRequiredString(formData, "nextStatus"));
  const redirectPath = assertRelativeRedirectPath(
    readRequiredString(formData, "redirectPath"),
  );
  const connectedAccountLabel = readOptionalString(formData, "connectedAccountLabel");
  const {
    connectionStateRepository,
    connectionStateTransitionRepository,
    connectionProviderCatalog,
  } = getDependencies();
  const useCase = new SetConnectionStateUseCase({
    connectionStateRepository,
    connectionStateTransitionRepository,
    connectionProviderCatalog,
  });

  await useCase.execute({
    reviewerId,
    provider,
    nextStatus,
    connectedAccountLabel,
  });

  revalidatePath(redirectPath);
  redirect(redirectPath);
}
