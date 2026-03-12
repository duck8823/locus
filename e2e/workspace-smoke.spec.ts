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
  await expect(
    page.getByText(/location details|位置情報/).first(),
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

test("localizes generated workspace copy when japanese locale is selected", async ({ page }) => {
  await openSeedWorkspace(page);
  await page.getByTestId("workspace-locale-ja").click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "セマンティックレビュー・デモワークスペース",
  );
  await expect(
    page.getByText("src/core/email-validator.ts のセマンティック差分").first(),
  ).toBeVisible();
  await expect(
    page.getByText("削除されたシンボルの呼び出し元を確認").first(),
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

test("persists AI suggestion decisions after reload", async ({ page }) => {
  await openSeedWorkspace(page);

  const adoptButton = page.getByRole("button", { name: /Adopt|採用/ }).first();
  await expect(adoptButton).toBeVisible();
  await adoptButton.click();
  await expect(page.getByText(/Adopted|採用済み/).first()).toBeVisible();

  await page.reload();
  await expect(page.getByText(/Adopted|採用済み/).first()).toBeVisible();
});

test("keeps review detail pane readable on narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSeedWorkspace(page);

  await expect(
    page.getByRole("heading", { level: 2, name: /Detail pane|詳細/ }),
  ).toBeVisible();
  await expect(page.getByTestId("status-button-reviewed")).toBeVisible();
  await expect(page.getByText(/location details|位置情報/).first()).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("shows unified recovery guidance for workspace retry errors", async ({ page }) => {
  await openSeedWorkspace(page);
  await page.goto("/reviews/demo-review?workspaceError=source_unavailable");

  await expect(
    page.getByText(
      /Reanalysis source is unavailable\. Reconnect GitHub OAuth and retry\.|再解析元が利用できません。GitHub OAuth を再接続して再試行してください。/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /If the issue continues, check connection status and review logs\.|継続する場合は接続状態とログを確認してください。/,
    ),
  ).toBeVisible();
});

test("queues reanalysis without action_failed redirect or workspace crash", async ({ page }) => {
  await openSeedWorkspace(page);

  await page.getByRole("button", { name: /Queue reanalysis|再解析をキュー投入/ }).click();

  await expect
    .poll(() => page.url(), { timeout: 30_000 })
    .toMatch(/\/reviews\/demo-review$/);

  const locationSummary = page.getByText(/location details|位置情報/).first();
  // Open and close the details panel to cover both toggle directions.
  await locationSummary.click();
  await locationSummary.click();

  await expect(page.getByText(/Workspace failed to load/)).toHaveCount(0);
  await expect(page.getByText(/Cannot read properties of null/)).toHaveCount(0);
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
