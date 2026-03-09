"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface AnalysisStatusPollerProps {
  active: boolean;
  intervalMs?: number;
}

export function AnalysisStatusPoller({
  active,
  intervalMs = 2500,
}: AnalysisStatusPollerProps) {
  const router = useRouter();

  useEffect(() => {
    if (!active) {
      return;
    }

    const intervalId = window.setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [active, intervalMs, router]);

  return null;
}
