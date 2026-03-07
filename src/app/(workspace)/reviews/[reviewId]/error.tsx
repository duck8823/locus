"use client";

export default function ReviewWorkspaceError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main style={{ padding: "64px 24px", maxWidth: "720px", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "12px" }}>Workspace failed to load</h1>
      <p style={{ color: "#9aa7d1", marginBottom: "20px" }}>{error.message}</p>
      <button
        onClick={reset}
        style={{
          border: "none",
          borderRadius: "12px",
          padding: "12px 18px",
          background: "#5e7bff",
          color: "white",
        }}
        type="button"
      >
        Try again
      </button>
    </main>
  );
}
