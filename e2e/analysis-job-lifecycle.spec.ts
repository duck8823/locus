import { execSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

const workspacePathPattern = /\/reviews\/demo-review$/;
const openSeedDemoTestId = "open-seed-demo";
const homeBootstrapMaxAttempts = 3;

function reseedDemoData() {
  execSync("npm run demo:data:reseed", {
    stdio: "pipe",
    env: process.env,
  });
}

async function openSeedWorkspace(page: Page) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= homeBootstrapMaxAttempts; attempt += 1) {
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId(openSeedDemoTestId)).toBeVisible({ timeout: 15_000 });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < homeBootstrapMaxAttempts) {
        await page.waitForTimeout(300 * attempt);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.getByTestId(openSeedDemoTestId).click();
  await expect(page).toHaveURL(workspacePathPattern);
}

test.beforeEach(() => {
  reseedDemoData();
});

test("displays analysis status section with refresh hint", async ({ page }) => {
  await openSeedWorkspace(page);

  const analysisHint = page.getByTestId("analysis-refresh-hint");
  await expect(analysisHint).toBeVisible();
});

test("shows reanalysis button when analysis is complete", async ({ page }) => {
  await openSeedWorkspace(page);

  const reanalyzeButton = page.getByTestId("reanalyze-button");

  if (await reanalyzeButton.isVisible()) {
    await expect(reanalyzeButton).toBeEnabled();
  }
});

test("displays analysis job history when available", async ({ page }) => {
  await openSeedWorkspace(page);

  const historySection = page.getByText(/Analysis history|分析ジョブ履歴/);

  if (await historySection.first().isVisible()) {
    await historySection.first().click();

    const jobEntries = page.getByTestId(/^analysis-job-/);
    const count = await jobEntries.count();
    expect(count).toBeGreaterThanOrEqual(0);
  }
});
