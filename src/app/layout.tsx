import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { resolveWorkspaceLocale } from "@/app/(workspace)/workspace-locale";
import "./globals.css";

export const metadata: Metadata = {
  title: "Locus",
  description: "Web shell skeleton for semantic pull-request review.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const workspaceLocale = resolveWorkspaceLocale({
    preferredLocale: cookieStore.get("locus-ui-locale")?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });

  return (
    <html lang={workspaceLocale}>
      <body>{children}</body>
    </html>
  );
}
