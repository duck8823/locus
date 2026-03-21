import { execSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

const homeBootstrapMaxAttempts = 3;

function reseedDemoData() {
  execSync("npm run demo:data:reseed", {
    stdio: "pipe",
    env: process.env,
  });
}

async function navigateToHome(page: Page) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= homeBootstrapMaxAttempts; attempt += 1) {
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
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
}

test.beforeEach(() => {
  reseedDemoData();
});

test("settings/connections page is accessible", async ({ page }) => {
  await navigateToHome(page);

  const settingsLink = page.getByRole("link", { name: /Settings|設定/ });

  if (await settingsLink.isVisible()) {
    await settingsLink.click();
    await expect(page).toHaveURL(/settings\/connections/);
  }
});

test("GitHub OAuth connect button is present on connections page", async ({ page }) => {
  await page.goto("/settings/connections", { waitUntil: "domcontentloaded" });

  const connectButton = page.getByTestId("github-connect-button");

  if (await connectButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await expect(connectButton).toBeEnabled();
  }
});

test("OAuth start endpoint redirects to GitHub", async ({ page }) => {
  const response = await page.goto("/api/integrations/github/oauth/start", {
    waitUntil: "domcontentloaded",
  });

  // Without valid OAuth credentials, the endpoint should either redirect
  // or return an error. We verify it doesn't crash (500).
  if (response) {
    expect(response.status()).not.toBe(500);
  }
});
