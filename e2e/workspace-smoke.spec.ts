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

async function tabUntilFocusedTestId(
  page: Page,
  targetTestId: string,
  maxTabs = 80,
) {
  for (let attempt = 0; attempt < maxTabs; attempt += 1) {
    await page.keyboard.press("Tab");
    const focusedTestId = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") ?? null,
    );

    if (focusedTestId === targetTestId) {
      return;
    }
  }

  throw new Error(`Keyboard focus could not reach data-testid=\"${targetTestId}\"`);
}

async function tabUntilFocusedTestIdPrefix(
  page: Page,
  targetTestIdPrefix: string,
  maxTabs = 80,
) {
  for (let attempt = 0; attempt < maxTabs; attempt += 1) {
    await page.keyboard.press("Tab");
    const focusedTestId = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") ?? null,
    );

    if (focusedTestId?.startsWith(targetTestIdPrefix)) {
      return focusedTestId;
    }
  }

  throw new Error(`Keyboard focus could not reach data-testid prefix=\"${targetTestIdPrefix}\"`);
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
  await page.getByText(/AI suggestions|AI提案/).first().click();
  await expect(
    page.getByText("削除されたシンボルの呼び出し元を確認").first(),
  ).toBeVisible();
});

test("keeps verbose hints behind expandable summaries with EN/JA labels", async ({ page }) => {
  await openSeedWorkspace(page);

  const analysisHint = page.getByTestId("analysis-refresh-hint");
  const businessContextHint = page.getByTestId("business-context-hint");

  await expect(analysisHint.getByText("Auto-refresh details")).toBeVisible();
  await expect(
    page.getByText(
      "Auto-refresh runs only while analysis is active (paused in background tabs).",
    ),
  ).not.toBeVisible();
  await analysisHint.getByText("Auto-refresh details").click();
  await expect(
    page.getByText(
      "Auto-refresh runs only while analysis is active (paused in background tabs).",
    ),
  ).toBeVisible();

  await page.getByText(/Business context|ビジネスコンテキスト/).first().click();
  await expect(businessContextHint.getByText("How links are inferred")).toBeVisible();
  await expect(
    page.getByText(
      "Phase 2 bridge: this panel shows requirement/spec links related to the current review.",
    ),
  ).not.toBeVisible();
  await businessContextHint.getByText("How links are inferred").click();
  await expect(
    page.getByText(
      "Phase 2 bridge: this panel shows requirement/spec links related to the current review.",
    ),
  ).toBeVisible();

  await page.getByTestId("workspace-locale-ja").click();
  await expect(analysisHint.getByText("自動更新の補足")).toBeVisible();
  await expect(businessContextHint.getByText("リンク推定の補足")).toBeVisible();
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

  await page.getByText(/AI suggestions|AI提案/).first().click();
  const adoptButton = page.getByRole("button", { name: /Adopt|採用/ }).first();
  await expect(adoptButton).toBeVisible();
  await adoptButton.click();
  await expect(page.getByText(/Adopted|採用済み/).first()).toBeVisible();

  await page.reload();
  await expect(page.getByText(/Adopted|採用済み/).first()).toBeVisible();
});

test("keeps dense detail sections collapsed on first render", async ({ page }) => {
  await openSeedWorkspace(page);

  await expect(page.getByRole("button", { name: /Adopt|採用/ }).first()).not.toBeVisible();
  await expect(page.getByText(/Average duration|平均所要時間/)).not.toBeVisible();

  await page.getByText(/AI suggestions|AI提案/).first().click();
  await expect(page.getByRole("button", { name: /Adopt|採用/ }).first()).toBeVisible();
});

test("persists reanalysis panel open state after reload", async ({ page }) => {
  await openSeedWorkspace(page);

  const reanalysisSummary = page.getByText(/Reanalysis status|再解析ステータス/).first();
  const reanalysisIdleText = page.getByText(/Not requested yet|未リクエスト/).first();

  await expect(reanalysisIdleText).not.toBeVisible();
  await reanalysisSummary.click();
  await expect(reanalysisIdleText).toBeVisible();

  await page.reload();
  await expect(reanalysisIdleText).toBeVisible();
});

test("supports keyboard-only interactions for core review controls", async ({ page }) => {
  await openSeedWorkspace(page);

  const localeJaButton = page.getByTestId("workspace-locale-ja");
  await localeJaButton.focus();
  await expect(localeJaButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("workspace-locale-en")).toBeFocused();

  await tabUntilFocusedTestIdPrefix(page, "group-button-group-");
  await expect(page.locator('[data-testid^=\"group-button-group-\"]:focus')).toHaveCount(1);

  await tabUntilFocusedTestId(page, "status-button-reviewed");
  await expect(page.getByTestId("status-button-reviewed")).toBeFocused();
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

test("uses japanese labels consistently in connections workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("marketing-locale-ja").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "PR レビュー画面をすぐに開けます。",
  );

  await page.goto("/settings/connections");

  await expect(page.getByRole("heading", { level: 1, name: "接続設定" })).toBeVisible();
  await expect(page.getByText("プロバイダーメモ").first()).toBeVisible();
  await expect(page.getByText(/Issue コンテキスト/).first()).toBeVisible();
  await expect(page.getByText(/このプロバイダーの状態変更はできません。/).first()).toBeVisible();
});
