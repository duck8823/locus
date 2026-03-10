"use client";

import { useFormStatus } from "react-dom";
import styles from "./page.module.css";

interface InitialAnalysisRetrySubmitButtonProps {
  idleLabel: string;
  pendingLabel: string;
}

export function InitialAnalysisRetrySubmitButton({
  idleLabel,
  pendingLabel,
}: InitialAnalysisRetrySubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button className={styles.actionButton} type="submit" disabled={pending}>
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
