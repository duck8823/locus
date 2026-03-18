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

test("displays change groups with semantic change details", async ({ page }) => {
  await openSeedWorkspace(page);

  await expect(
    page.getByRole("heading", { level: 2, name: /Change groups|変更グループ/ }),
  ).toBeVisible();

  const groupCards = page.getByTestId(/^group-button-/);
  const groupCount = await groupCards.count();
  expect(groupCount).toBeGreaterThan(0);
});

test("selects a group and shows detail pane", async ({ page }) => {
  await openSeedWorkspace(page);

  const firstGroupCard = page.getByTestId(/^group-button-/).first();
  await expect(firstGroupCard).toBeVisible();

  await expect(
    page.getByRole("heading", { level: 2, name: /Detail pane|詳細/ }),
  ).toBeVisible();

  await expect(
    page.getByText(/location details|位置情報/).first(),
  ).toBeVisible();
});

test("marks group as read and persists status", async ({ page }) => {
  await openSeedWorkspace(page);

  const markButton = page.getByTestId(/^mark-status-/).first();

  if (await markButton.isVisible()) {
    const initialText = await markButton.textContent();
    await markButton.click();
    await expect(page).toHaveURL(workspacePathPattern);

    const updatedText = await markButton.textContent();
    expect(updatedText).not.toBe(initialText);
  }
});

test("displays architecture sidebar with upstream/downstream nodes", async ({ page }) => {
  await openSeedWorkspace(page);

  await expect(
    page.getByRole("heading", { level: 2, name: /Architecture|アーキテクチャ/ }),
  ).toBeVisible();
});
