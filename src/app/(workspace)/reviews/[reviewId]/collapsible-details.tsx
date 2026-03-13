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

function readLocalStorageSafely(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
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
  } catch {
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
  } catch {
    // best-effort persistence
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
