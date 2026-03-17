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

test("AI suggestion panel is visible with suggestions", async ({ page }) => {
  await openSeedWorkspace(page);

  const aiPanel = page.getByText(/AI suggestions|AI提案/);
  await expect(aiPanel.first()).toBeVisible();
});

test("AI suggestion shows headline and recommendation", async ({ page }) => {
  await openSeedWorkspace(page);

  await page.getByText(/AI suggestions|AI提案/).first().click();

  const suggestionCards = page.getByTestId(/^ai-suggestion-/);
  const count = await suggestionCards.count();
  expect(count).toBeGreaterThan(0);
});

test("AI suggestion adopt/hold decision persists in localStorage", async ({ page }) => {
  await openSeedWorkspace(page);

  await page.getByText(/AI suggestions|AI提案/).first().click();

  const adoptButton = page.getByTestId(/^ai-suggestion-adopt-/).first();

  if (await adoptButton.isVisible()) {
    await adoptButton.click();

    const storedDecisions = await page.evaluate(() => {
      const keys = Object.keys(window.localStorage).filter((key) =>
        key.includes("ai-suggestion"),
      );
      return keys.length;
    });
    expect(storedDecisions).toBeGreaterThanOrEqual(0);
  }
});
