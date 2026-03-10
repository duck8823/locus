"use client";

import { useState, type ReactNode } from "react";

interface CollapsibleDetailsProps {
  className?: string;
  summaryClassName?: string;
  contentClassName?: string;
  summary: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function resolveCollapsibleOpenState(input: {
  manualOpen: boolean | null;
  defaultOpen: boolean;
}): boolean {
  return input.manualOpen ?? input.defaultOpen;
}

export function CollapsibleDetails({
  className,
  summaryClassName,
  contentClassName,
  summary,
  defaultOpen = false,
  children,
}: CollapsibleDetailsProps) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = resolveCollapsibleOpenState({ manualOpen, defaultOpen });

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
