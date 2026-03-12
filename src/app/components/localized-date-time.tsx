"use client";

import { useMemo } from "react";

export interface LocalizedDateTimeProps {
  isoTimestamp: string;
  locale?: "ja" | "en";
}

export function resolveLocalizedDateTimeLocale(locale?: "ja" | "en"): string | undefined {
  if (locale === "ja") {
    return "ja-JP";
  }

  if (locale === "en") {
    return "en-US";
  }

  return undefined;
}

export function LocalizedDateTime({ isoTimestamp, locale }: LocalizedDateTimeProps) {
  const label = useMemo(
    () =>
      new Intl.DateTimeFormat(resolveLocalizedDateTimeLocale(locale), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(isoTimestamp)),
    [isoTimestamp, locale],
  );

  return (
    <time dateTime={isoTimestamp} suppressHydrationWarning>
      {label}
    </time>
  );
}
