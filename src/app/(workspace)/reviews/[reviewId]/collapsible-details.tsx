"use client";

import { useEffect, useState, type ReactNode } from "react";

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
        setManualOpen(nextOpen);
        writePersistedManualOpen({
          storage: readLocalStorageSafely(),
          storageKey: storageKey ?? null,
          manualOpen: nextOpen,
        });
      }}
    >
      <summary className={summaryClassName}>
        {summary}
      </summary>
      <div className={contentClassName}>{children}</div>
    </details>
  );
}
