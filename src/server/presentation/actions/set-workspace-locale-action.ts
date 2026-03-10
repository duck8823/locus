"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readRequiredString } from "@/server/presentation/actions/read-required-string";

const supportedLocales = new Set(["ja", "en"]);

function assertWorkspaceLocale(value: string): "ja" | "en" {
  if (!supportedLocales.has(value)) {
    throw new Error(`Unsupported workspace locale: ${value}`);
  }

  return value as "ja" | "en";
}

export async function setWorkspaceLocaleAction(formData: FormData): Promise<void> {
  const reviewId = readRequiredString(formData, "reviewId");
  const locale = assertWorkspaceLocale(readRequiredString(formData, "locale"));
  const cookieStore = await cookies();

  cookieStore.set("locus-ui-locale", locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath(`/reviews/${reviewId}`);
  redirect(`/reviews/${reviewId}`);
}
