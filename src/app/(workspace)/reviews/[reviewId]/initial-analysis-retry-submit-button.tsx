"use client";

import { useFormStatus } from "react-dom";
import styles from "./page.module.css";

export function InitialAnalysisRetrySubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className={styles.actionButton} type="submit" disabled={pending}>
      {pending ? "Retrying..." : "Retry initial analysis"}
    </button>
  );
}
