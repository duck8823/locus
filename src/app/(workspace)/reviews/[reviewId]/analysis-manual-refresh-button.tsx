"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

interface AnalysisManualRefreshButtonProps {
  idleLabel: string;
  pendingLabel: string;
}

export function AnalysisManualRefreshButton({
  idleLabel,
  pendingLabel,
}: AnalysisManualRefreshButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className={styles.actionButton}
      disabled={isPending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
      type="button"
    >
      {isPending ? pendingLabel : idleLabel}
    </button>
  );
}
