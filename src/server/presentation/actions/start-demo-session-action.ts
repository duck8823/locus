"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OpenReviewWorkspaceUseCase } from "@/server/application/usecases/open-review-workspace";
import { defaultSeedReviewId } from "@/server/application/services/review-session-seed";
import { getDependencies } from "@/server/composition/dependencies";

const demoViewerCookieName = "locus-demo-viewer";

export async function startDemoSessionAction(): Promise<void> {
  const viewerName = "Demo reviewer";
  const cookieStore = await cookies();

  cookieStore.set(demoViewerCookieName, viewerName, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  const { reviewSessionRepository, parserAdapters } = getDependencies();
  const useCase = new OpenReviewWorkspaceUseCase({ reviewSessionRepository, parserAdapters });
  await useCase.execute({ reviewId: defaultSeedReviewId, viewerName });

  redirect(`/reviews/${defaultSeedReviewId}`);
}
