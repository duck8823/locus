import { type NextRequest } from "next/server";
import { getDependencies } from "@/server/composition/dependencies";
import { buildAiSuggestionPayload } from "@/server/application/ai/build-ai-suggestion-payload";


export const dynamic = "force-dynamic";

function encodeSSEEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  const { reviewId } = await params;
  const { reviewSessionRepository, aiSuggestionProvider } = getDependencies();

  const reviewSession = await reviewSessionRepository.findByReviewId(reviewId);

  if (!reviewSession) {
    return new Response(
      encodeSSEEvent("error", { message: "Review not found" }),
      {
        status: 404,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(encodeSSEEvent(event, data)));
        } catch {
          // Controller may be closed if client disconnected.
        }
      };

      try {
        const record = reviewSession.toRecord();
        const selectedGroup = record.groups.find(
          (g) => g.groupId === record.selectedGroupId,
        );

        const payload = buildAiSuggestionPayload({
          review: {
            reviewId: record.reviewId,
            title: record.title,
            repositoryName: record.repositoryName,
            branchLabel: record.branchLabel,
          },
          selectedGroup: selectedGroup
            ? {
                groupId: selectedGroup.groupId,
                title: selectedGroup.title,
                filePath: selectedGroup.filePath,
                semanticChanges: (record.semanticChanges ?? [])
                  .filter((sc) =>
                    selectedGroup.semanticChangeIds?.includes(sc.semanticChangeId),
                  )
                  .map((sc) => ({
                    semanticChangeId: sc.semanticChangeId,
                    symbolDisplayName: sc.symbol.displayName,
                    symbolKind: sc.symbol.kind,
                    changeType: sc.change.type,
                    signatureSummary: sc.change.signatureSummary ?? null,
                    bodySummary: sc.change.bodySummary ?? null,
                    before: sc.before ?? null,
                    after: sc.after ?? null,
                  })),
                architectureGraph: {
                  nodes: [],
                  edges: [],
                },
              }
            : null,
          businessContextItems: [],
        });

        send("start", { reviewId });

        const suggestions = await aiSuggestionProvider.generateSuggestions({
          payload,
          captureMetadata: (metadata) => {
            send("metadata", {
              provider: metadata.provider,
              fallbackApplied: metadata.fallbackApplied,
              reasonCode: metadata.reasonCode,
            });
          },
        });

        for (const suggestion of suggestions) {
          send("suggestion", suggestion);
        }

        send("done", { count: suggestions.length });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "AI suggestion generation failed";
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
