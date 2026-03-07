import { cookies } from "next/headers";
import Link from "next/link";

export default async function ConnectionsPage() {
  const cookieStore = await cookies();
  const viewerName = cookieStore.get("locus-demo-viewer")?.value ?? "Signed out";

  return (
    <main
      style={{
        maxWidth: "960px",
        margin: "0 auto",
        padding: "48px 24px 72px",
        display: "grid",
        gap: "20px",
      }}
    >
      <Link href="/" style={{ color: "#9aa7d1" }}>
        ← Back to marketing page
      </Link>
      <section
        style={{
          border: "1px solid #2a3563",
          borderRadius: "24px",
          background: "rgba(18, 25, 51, 0.88)",
          padding: "28px",
        }}
      >
        <p style={{ color: "#9aa7d1", marginBottom: "12px" }}>Auth stub</p>
        <h1 style={{ fontSize: "36px", marginBottom: "12px" }}>Connections</h1>
        <p style={{ color: "#9aa7d1", marginBottom: "18px" }}>
          This page is the placeholder surface for future GitHub, issue tracker,
          and document-source integrations.
        </p>
        <p>
          Current reviewer identity: <strong>{viewerName}</strong>
        </p>
      </section>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
        }}
      >
        {[
          ["GitHub", "OAuth flow not implemented yet"],
          ["Confluence", "Context overlay arrives in a later slice"],
          ["Jira", "Issue linkage is outside the first web shell"],
        ].map(([title, summary]) => (
          <article
            key={title}
            style={{
              border: "1px solid rgba(154, 167, 209, 0.16)",
              borderRadius: "18px",
              background: "rgba(18, 25, 51, 0.78)",
              padding: "20px",
            }}
          >
            <h2 style={{ marginBottom: "8px" }}>{title}</h2>
            <p style={{ color: "#9aa7d1" }}>{summary}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
