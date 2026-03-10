import { execSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

const workspacePathPattern = /\/reviews\/demo-review$/;

function reseedDemoData() {
  execSync("npm run demo:data:reseed", {
    stdio: "pipe",
    env: process.env,
  });
}

async function openSeedWorkspace(page: Page) {
  await page.goto("/");
  await page.getByTestId("open-seed-demo").click();
  await expect(page).toHaveURL(workspacePathPattern);
}

test.beforeEach(() => {
  reseedDemoData();
});

test("opens the seed workspace without external integrations", async ({ page }) => {
  await openSeedWorkspace(page);

  await expect(
    page.getByRole("heading", { level: 2, name: /Change groups|変更グループ/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: /Detail pane|詳細/ }),
  ).toBeVisible();
});

test("switches locale on marketing and workspace pages", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("marketing-locale-ja").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "PR レビュー画面をすぐに開けます。",
  );

  await page.getByTestId("open-seed-demo").click();
  await expect(page).toHaveURL(workspacePathPattern);

  await page.getByTestId("workspace-locale-en").click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Change groups" }),
  ).toBeVisible();
});

test("keeps review status changes after reload", async ({ page }) => {
  await openSeedWorkspace(page);

  await page.getByTestId("status-button-reviewed").click();
  await expect(page).toHaveURL(workspacePathPattern);
  await page.reload();
  await expect(page).toHaveURL(workspacePathPattern);

  const selectedGroup = page.locator(
    'button[data-testid^="group-button-"][data-selected="true"]',
  );
  await expect(selectedGroup).toContainText(/Reviewed|確認済み/);
});
