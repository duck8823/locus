"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OpenReviewWorkspaceUseCase } from "@/server/application/usecases/open-review-workspace";
import { getDependencies } from "@/server/composition/dependencies";

const demoReviewId = "demo-review";
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

  const { reviewSessionRepository } = getDependencies();
  const useCase = new OpenReviewWorkspaceUseCase({ reviewSessionRepository });
  await useCase.execute({ reviewId: demoReviewId, viewerName });

  redirect(`/reviews/${demoReviewId}`);
}
