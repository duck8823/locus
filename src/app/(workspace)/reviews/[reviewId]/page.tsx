import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "./page.module.css";
import { LocalizedDateTime } from "@/app/components/localized-date-time";
import { loadReviewWorkspaceDto } from "@/server/presentation/api/load-review-workspace";
import { requestReanalysisAction } from "@/server/presentation/actions/request-reanalysis-action";
import { selectReviewGroupAction } from "@/server/presentation/actions/select-review-group-action";
import { setReviewGroupStatusAction } from "@/server/presentation/actions/set-review-group-status-action";
import {
  groupArchitectureNodes,
  type ArchitectureNodeGroups,
} from "@/server/presentation/formatters/architecture-node";

function formatReviewGroupStatus(status: string) {
  return status.replaceAll("_", " ");
}

const ARCHITECTURE_CATEGORY_ORDER = ["layer", "file", "symbol", "unknown"] as const;
const ARCHITECTURE_CATEGORY_LABELS: Record<keyof ArchitectureNodeGroups, string> = {
  layer: "Layers",
  file: "Files",
  symbol: "Symbols",
  unknown: "Others",
};

interface ArchitectureColumn {
  label: "Upstream" | "Downstream";
  nodes: string[];
}

export default async function ReviewWorkspacePage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  const cookieStore = await cookies();
  const viewerName = cookieStore.get("locus-demo-viewer")?.value;

  if (!viewerName) {
    redirect("/");
  }

  const workspace = await loadReviewWorkspaceDto({ reviewId });
  const selectedGroup =
    workspace.groups.find((group) => group.isSelected) ?? workspace.groups[0];
  const architectureColumns: ArchitectureColumn[] = selectedGroup
    ? [
        { label: "Upstream", nodes: selectedGroup.upstream },
        { label: "Downstream", nodes: selectedGroup.downstream },
      ]
    : [];

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <Link href="/" className={styles.muted}>
            ← Back to marketing page
          </Link>
          <h1 style={{ marginTop: "12px", marginBottom: "10px", fontSize: "40px" }}>
            {workspace.title}
          </h1>
          <div className={styles.meta}>
            <span>Reviewer: {workspace.viewerName}</span>
            <span>Repository: {workspace.repositoryName}</span>
            <span>Branch: {workspace.branchLabel}</span>
            <span>
              Last opened: <LocalizedDateTime isoTimestamp={workspace.lastOpenedAt} />
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <Link className={styles.actionButton} href="/settings/connections">
            Connections
          </Link>
          <form action={requestReanalysisAction}>
            <input name="reviewId" type="hidden" value={workspace.reviewId} />
            <button className={styles.actionButton} type="submit">
              Queue reanalysis stub
            </button>
          </form>
        </div>
      </div>

      <div className={styles.layout}>
        <section className={styles.panel}>
          <h2>Change groups</h2>
          {workspace.groups.length > 0 ? (
            <ul className={styles.groupList}>
              {workspace.groups.map((group) => (
                <li key={group.groupId}>
                  <form action={selectReviewGroupAction}>
                    <input name="reviewId" type="hidden" value={workspace.reviewId} />
                    <input name="groupId" type="hidden" value={group.groupId} />
                    <button
                      className={styles.groupButton}
                      data-selected={group.isSelected}
                      type="submit"
                    >
                      <span className={styles.groupTitle}>
                        <span>{group.title}</span>
                        <span className={styles.badge} data-status={group.status}>
                          {formatReviewGroupStatus(group.status)}
                        </span>
                      </span>
                      <p className={styles.groupSummary}>{group.summary}</p>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No change groups are available yet.</p>
          )}
        </section>

        <section className={styles.panel}>
          <h2>Detail pane</h2>
          {selectedGroup ? (
            <>
              <div className={styles.detailBlock}>
                <span className={styles.badge} data-status={selectedGroup.status}>
                  {formatReviewGroupStatus(selectedGroup.status)}
                </span>
                <h3 style={{ fontSize: "26px" }}>{selectedGroup.title}</h3>
                <p className={styles.groupSummary}>{selectedGroup.summary}</p>
                <p className={styles.filePath}>{selectedGroup.filePath}</p>
              </div>

              <form action={setReviewGroupStatusAction} className={styles.statusActions}>
                <input name="reviewId" type="hidden" value={workspace.reviewId} />
                <input name="groupId" type="hidden" value={selectedGroup.groupId} />
                {workspace.availableStatuses.map((status) => (
                  <button
                    key={status}
                    className={styles.statusButton}
                    data-active={selectedGroup.status === status}
                    name="status"
                    type="submit"
                    value={status}
                  >
                    Mark {formatReviewGroupStatus(status)}
                  </button>
                ))}
              </form>
            </>
          ) : (
            <div className={styles.detailBlock}>
              <p className={styles.groupSummary}>
                Change group details will appear after semantic analysis produces the first
                review group.
              </p>
            </div>
          )}

          <div className={styles.detailBlock}>
            <span className={styles.muted}>Why this exists</span>
            <p>
              This workspace is server-rendered from a persisted review session so
              the initial shell can be reopened without losing progress or the
              currently selected change group.
            </p>
          </div>
          <div className={styles.detailBlock}>
            <span className={styles.muted}>Reanalysis status</span>
            <p>
              {workspace.lastReanalyzeRequestedAt ? (
                <>
                  Queued at <LocalizedDateTime isoTimestamp={workspace.lastReanalyzeRequestedAt} />
                </>
              ) : (
                "Not requested yet"
              )}
            </p>
          </div>
        </section>

        <aside className={styles.panel}>
          <h2>Architecture pane</h2>
          <p className={styles.muted} style={{ marginBottom: "14px" }}>
            Slice 1 keeps this to immediate neighbors only.
          </p>
          {selectedGroup ? (
            <div className={styles.archColumns}>
              {architectureColumns.map((column) => {
                const groupedNodes = groupArchitectureNodes(column.nodes);
                const categories = ARCHITECTURE_CATEGORY_ORDER.map((category) => [category, groupedNodes[category]] as const)
                  .filter(([, nodes]) => nodes.length > 0);

                return (
                  <div key={column.label} className={styles.archColumn}>
                    <h3>{column.label}</h3>
                    {categories.length === 0 ? (
                      <p className={styles.muted}>No related nodes.</p>
                    ) : (
                      <div className={styles.archSections}>
                        {categories.map(([category, nodes]) => (
                          <section
                            key={`${column.label}-${category}`}
                            aria-labelledby={`arch-${column.label.toLowerCase()}-${category}`}
                            className={styles.archSection}
                          >
                            <h4 id={`arch-${column.label.toLowerCase()}-${category}`}>{ARCHITECTURE_CATEGORY_LABELS[category]}</h4>
                            <ul className={styles.archNodeList}>
                              {nodes.map((node) => (
                                <li key={`${column.label}-${node.raw}`}>
                                  <span className={styles.archNodeLabel}>{node.label}</span>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={styles.muted}>
              Architecture context will appear after the first change group is available.
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
