"use client";

import { useFormStatus } from "react-dom";
import styles from "./page.module.css";

interface ReanalyzeSubmitButtonProps {
  idleLabel: string;
  pendingLabel: string;
}

export function ReanalyzeSubmitButton({
  idleLabel,
  pendingLabel,
}: ReanalyzeSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button className={styles.actionButton} type="submit" disabled={pending}>
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
