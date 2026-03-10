"use client";

import { useRef, useState, type ReactNode } from "react";

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

export function resolveManualOpenOnToggle(input: {
  hasManualToggleIntent: boolean;
  nextOpen: boolean;
  previousManualOpen: boolean | null;
}): boolean | null {
  if (!input.hasManualToggleIntent) {
    return input.previousManualOpen;
  }

  return input.nextOpen;
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
  const hasManualToggleIntentRef = useRef(false);
  const open = resolveCollapsibleOpenState({ manualOpen, defaultOpen });

  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => {
        const shouldPersistManualState = hasManualToggleIntentRef.current;
        hasManualToggleIntentRef.current = false;
        setManualOpen((previousManualOpen) =>
          resolveManualOpenOnToggle({
            hasManualToggleIntent: shouldPersistManualState,
            nextOpen: event.currentTarget.open,
            previousManualOpen,
          }),
        );
      }}
    >
      <summary
        className={summaryClassName}
        onClick={() => {
          hasManualToggleIntentRef.current = true;
        }}
      >
        {summary}
      </summary>
      <div className={contentClassName}>{children}</div>
    </details>
  );
}
