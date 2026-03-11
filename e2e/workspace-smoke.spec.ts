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
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByTestId("status-button-reviewed").getAttribute("data-active");
      },
      { timeout: 30_000 },
    )
    .toBe("true");
  await page.reload();
  await expect(page).toHaveURL(workspacePathPattern);
  await expect(page.getByTestId("status-button-reviewed")).toHaveAttribute(
    "data-active",
    "true",
  );
});

test("persists connection state transitions in settings workspace", async ({ page }) => {
  await openSeedWorkspace(page);
  await page.goto("/settings/connections");

  await page.getByText(/Advanced: manual state override|詳細: 手動状態変更/).first().click();
  const transitionSelect = page.getByTestId("connection-transition-select-github");
  await expect(transitionSelect).toBeVisible();
  await transitionSelect.selectOption("not_connected");
  await page.getByTestId("connection-transition-submit-github").click();

  await expect
    .poll(
      async () => {
        await page.reload();
        const text = await page.getByTestId("connection-status-github").innerText();
        return text;
      },
      { timeout: 30_000 },
    )
    .toMatch(/Not connected|未接続/);

  const historySummary = page
    .getByText(/Recent transitions|最近の状態変更/)
    .first();
  await expect(historySummary).toBeVisible();
  await historySummary.click();
  await expect(
    page.getByText(/Connected → Not connected|接続済み → 未接続/),
  ).toBeVisible();
});

test("connects GitHub via OAuth flow fallback and keeps URL clean", async ({ page }) => {
  await openSeedWorkspace(page);
  await page.goto("/settings/connections");

  await page.getByText(/Advanced: manual state override|詳細: 手動状態変更/).first().click();
  await page.getByTestId("connection-transition-select-github").selectOption("not_connected");
  await page.getByTestId("connection-transition-submit-github").click();

  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByTestId("connection-status-github").innerText();
      },
      { timeout: 30_000 },
    )
    .toMatch(/Not connected|未接続/);

  await page.getByRole("link", { name: /Connect with GitHub OAuth|GitHub OAuthで接続/ }).click();

  await expect
    .poll(
      async () => {
        await page.reload();
        const statusText = await page.getByTestId("connection-status-github").innerText();
        return {
          statusText,
          url: page.url(),
        };
      },
      { timeout: 30_000 },
    )
    .toMatchObject({
      statusText: expect.stringMatching(/Status:|状態:/),
      url: expect.stringContaining("/settings/connections"),
    });
  expect(page.url()).not.toContain("oauthSuccess=");
  expect(page.url()).not.toContain("oauthError=");
});

test("keeps settings layout readable on narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSeedWorkspace(page);
  await page.goto("/settings/connections");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /Connections|接続設定/,
  );
  await expect(page.getByText(/History filter|履歴フィルター/)).toBeVisible();
  await expect(page.getByText(/Recent transitions|最近の状態変更/).first()).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
