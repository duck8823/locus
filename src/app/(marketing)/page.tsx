import Link from "next/link";
import styles from "./page.module.css";
import { startDemoSessionAction } from "@/server/presentation/actions/start-demo-session-action";

export default function MarketingPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.panel}>
            <span className={styles.kicker}>Slice 1 · Web shell skeleton</span>
            <h1>Review architecture, state, and progress in one place.</h1>
            <p>
              Locus now has a runnable Next.js shell that honors the layered
              server boundaries from the docs. The first workspace is demo-backed,
              auth-stubbed, and reopenable.
            </p>
            <div className={styles.ctas}>
              <form action={startDemoSessionAction}>
                <button className={styles.primaryButton} type="submit">
                  Open demo review workspace
                </button>
              </form>
              <Link className={styles.secondaryLink} href="/settings/connections">
                View connection stubs
              </Link>
            </div>
          </div>

          <aside className={styles.sidePanel}>
            <div>
              <h2>What is wired already</h2>
              <ul>
                <li>
                  <span className={styles.sideLabel}>Auth stub</span>
                  Demo reviewer identity is persisted in a cookie so the workspace
                  can gate entry without a real OAuth flow yet.
                </li>
                <li>
                  <span className={styles.sideLabel}>Workspace state</span>
                  Selected change group and review progress are persisted via a
                  file-backed repository for the initial flow.
                </li>
                <li>
                  <span className={styles.sideLabel}>BFF surface</span>
                  Route handlers and server actions already call into use cases
                  instead of reaching into infrastructure from the App Router.
                </li>
              </ul>
            </div>
          </aside>
        </section>

        <section className={styles.cards}>
          <article className={styles.card}>
            <h3>Framework surface</h3>
            <p>
              App Router pages and route handlers stay thin and only delegate to
              presentation helpers or application use cases.
            </p>
          </article>
          <article className={styles.card}>
            <h3>Layered server</h3>
            <p>
              Domain, application, presentation, and infrastructure folders now
              exist in runnable form, with lint rules that guard the boundaries.
            </p>
          </article>
          <article className={styles.card}>
            <h3>Next implementation step</h3>
            <p>
              The workspace is ready for fixture-backed review sessions and the
              first parser-driven semantic analysis slice.
            </p>
            <ul>
              <li>Review state persistence</li>
              <li>Empty review workspace navigation</li>
              <li>Webhook and progress endpoints scaffolded</li>
            </ul>
          </article>
        </section>
      </div>
    </main>
  );
}
