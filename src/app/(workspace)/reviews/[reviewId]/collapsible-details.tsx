"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const COLLAPSIBLE_STORAGE_PREFIX = "locus-collapsible";

interface CollapsibleDetailsProps {
  className?: string;
  summaryClassName?: string;
  contentClassName?: string;
  summary: ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
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

function resolveStorageRecordKey(storageKey: string): string {
  return `${COLLAPSIBLE_STORAGE_PREFIX}:${storageKey}`;
}

function reportStoragePersistenceError(input: {
  context: string;
  error: unknown;
}): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.warn(
    `[CollapsibleDetails] Failed to ${input.context} persisted panel state.`,
    input.error,
  );
}

function readLocalStorageSafely(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch (error) {
    reportStoragePersistenceError({ context: "access", error });
    return null;
  }
}

export function readPersistedManualOpen(input: {
  storage: Storage | null;
  storageKey: string | null;
}): boolean | null {
  if (!input.storage || !input.storageKey) {
    return null;
  }

  try {
    const rawValue = input.storage.getItem(resolveStorageRecordKey(input.storageKey));

    if (rawValue === "open") {
      return true;
    }

    if (rawValue === "closed") {
      return false;
    }

    return null;
  } catch (error) {
    reportStoragePersistenceError({ context: "read", error });
    return null;
  }
}

export function writePersistedManualOpen(input: {
  storage: Storage | null;
  storageKey: string | null;
  manualOpen: boolean | null;
}): void {
  if (!input.storage || !input.storageKey) {
    return;
  }

  const recordKey = resolveStorageRecordKey(input.storageKey);

  try {
    if (input.manualOpen === null) {
      input.storage.removeItem(recordKey);
      return;
    }

    input.storage.setItem(recordKey, input.manualOpen ? "open" : "closed");
  } catch (error) {
    reportStoragePersistenceError({ context: "write", error });
  }
}

export function CollapsibleDetails({
  className,
  summaryClassName,
  contentClassName,
  summary,
  defaultOpen = false,
  storageKey,
  children,
}: CollapsibleDetailsProps) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const manualToggleIntentRef = useRef(false);
  const open = resolveCollapsibleOpenState({ manualOpen, defaultOpen });

  useEffect(() => {
    const persistedManualOpen = readPersistedManualOpen({
      storage: readLocalStorageSafely(),
      storageKey: storageKey ?? null,
    });
    let canceled = false;
    // Avoid setState-in-effect lint while keeping hydration-safe persisted state restore.
    queueMicrotask(() => {
      if (!canceled) {
        setManualOpen(persistedManualOpen);
      }
    });

    return () => {
      canceled = true;
    };
  }, [storageKey]);

  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        const hasManualToggleIntent = manualToggleIntentRef.current;
        manualToggleIntentRef.current = false;
        const nextManualOpen = resolveManualOpenOnToggle({
          hasManualToggleIntent,
          nextOpen,
          previousManualOpen: manualOpen,
        });
        setManualOpen(nextManualOpen);

        if (nextManualOpen === manualOpen) {
          return;
        }

        writePersistedManualOpen({
          storage: readLocalStorageSafely(),
          storageKey: storageKey ?? null,
          manualOpen: nextManualOpen,
        });
      }}
    >
      <summary
        className={summaryClassName}
        onClickCapture={() => {
          manualToggleIntentRef.current = true;
        }}
        onKeyDownCapture={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            manualToggleIntentRef.current = true;
          }
        }}
      >
        {summary}
      </summary>
      <div className={contentClassName}>{children}</div>
    </details>
  );
}
