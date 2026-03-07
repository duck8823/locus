"use client";

import { useMemo } from "react";

export interface LocalizedDateTimeProps {
  isoTimestamp: string;
}

export function LocalizedDateTime({ isoTimestamp }: LocalizedDateTimeProps) {
  const label = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(isoTimestamp)),
    [isoTimestamp],
  );

  return <time dateTime={isoTimestamp}>{label}</time>;
}
