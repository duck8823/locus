"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export function AnalysisManualRefreshButton() {
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
      {isPending ? "Refreshing..." : "Reload now"}
    </button>
  );
}
