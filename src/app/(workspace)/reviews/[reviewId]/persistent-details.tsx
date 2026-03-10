"use client";

import { useState, type ReactNode } from "react";

interface PersistentDetailsProps {
  className?: string;
  summaryClassName?: string;
  contentClassName?: string;
  summary: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function PersistentDetails({
  className,
  summaryClassName,
  contentClassName,
  summary,
  defaultOpen = false,
  children,
}: PersistentDetailsProps) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? defaultOpen;

  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => {
        setManualOpen(event.currentTarget.open);
      }}
    >
      <summary className={summaryClassName}>{summary}</summary>
      <div className={contentClassName}>{children}</div>
    </details>
  );
}
