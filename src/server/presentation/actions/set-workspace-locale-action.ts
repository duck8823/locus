"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readRequiredString } from "@/server/presentation/actions/read-required-string";
import { WORKSPACE_LOCALE_COOKIE_NAME } from "./workspace-locale-cookie-name";

const supportedLocales = new Set(["ja", "en"]);

function assertWorkspaceLocale(value: string): "ja" | "en" {
  if (!supportedLocales.has(value)) {
    throw new Error(`Unsupported workspace locale: ${value}`);
  }

  return value as "ja" | "en";
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

export async function setWorkspaceLocaleAction(formData: FormData): Promise<void> {
  const redirectPath = assertRelativeRedirectPath(
    readRequiredString(formData, "redirectPath"),
  );
  const locale = assertWorkspaceLocale(readRequiredString(formData, "locale"));
  const cookieStore = await cookies();

  cookieStore.set(WORKSPACE_LOCALE_COOKIE_NAME, locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath(redirectPath);
  redirect(redirectPath);
}
