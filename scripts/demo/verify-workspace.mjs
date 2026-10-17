import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:4000";
const browser = await chromium.launch({ headless: true });
await mkdir("demo/trial", { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [], savedPlans = [], profileWrites = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/profile**", async (route) => {
    if (route.request().method() === "POST") profileWrites.push(route.request().postDataJSON());
    await route.fulfill({ json: null });
  });
  await page.route("**/api/plans**", async (route) => {
    if (route.request().method() === "POST") savedPlans.push(route.request().postDataJSON());
    await route.fulfill({ json: route.request().method() === "GET" ? savedPlans : { ok: true } });
  });
  await page.route("**/api/jds", (route) => route.fulfill({ json: [] }));
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.goto(base);
  await page.getByLabel("最近一件你认真做过的事").waitFor();
  assert.equal(await page.locator(".sidebar,.metric-grid").count(), 0);
  assert.equal(await page.getByRole("button", { name: "拆开这段经历" }).isDisabled(), true);
  await page.screenshot({ path: "demo/trial/desktop-entry.png", fullPage: true });
  for (const width of [320, 390, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow();
    if (width === 390) await page.screenshot({ path: "demo/trial/mobile-entry.png", fullPage: true });
  }
  await page.getByRole("button", { name: "试一段示例" }).click();
  await page.getByRole("button", { name: "拆开这段经历" }).click();
  await page.getByRole("heading", { name: "这段经历里，哪些是你真正做过的？" }).waitFor();
  assert.ok((await page.locator(".source-quote").innerText()).includes("Excel"));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow();
    if (width === 390) await page.screenshot({ path: "demo/trial/mobile-skills.png", fullPage: true });
  }
  await page.getByRole("button", { name: "带着这些能力，看看可能的方向" }).click();
  await page.locator(".choice-options").waitFor();
  assert.equal(await page.locator(".choice-option").count(), 3);
  await page.locator(".choice-option").nth(1).click();
  assert.equal(await page.locator(".choice-option").nth(1).getAttribute("aria-pressed"), "true");
  const selected = await page.locator(".choice-detail h2").innerText();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow();
    await page.locator("canvas").scrollIntoViewIfNeeded();
    assert.ok(await page.locator("canvas").evaluate((canvas) => {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    }));
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `demo/trial/choices-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "就从这个方向试起" }).click();
  await page.getByRole("heading", { name: "检查我的岗位证据" }).waitFor();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow();
    if (width === 390) await page.screenshot({ path: "demo/trial/mobile-gap.png", fullPage: true });
  }
  await page.getByRole("button", { name: "生成下一步行动", exact: true }).click();
  await page.locator(".first-action").waitFor();
  assert.ok((await page.locator("main").innerText()).includes(selected));
  const firstAction = await page.locator(".first-action h3").innerText();
  await page.locator(".action-check input").check();
  assert.equal(await page.locator(".first-action h3").innerText(), firstAction, "Keep completed action visible until the user advances");
  assert.equal(await page.locator(".action-check input").isChecked(), true);
  await page.getByRole("button", { name: "保存这份规划" }).click();
  await page.getByRole("button", { name: "已保存", exact: true }).waitFor();
  assert.equal(savedPlans.length, 1);
  assert.match(savedPlans[0].markdown, /已完成/);
  assert.equal(profileWrites.length, 0, "Demo must not autosave personal profile");
  await page.getByRole("button", { name: "查看下一项待办" }).click();
  assert.notEqual(await page.locator(".first-action h3").innerText(), firstAction);
  assert.equal(await page.locator(".action-check input").isChecked(), false);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow();
    await page.screenshot({ path: `demo/trial/action-${width}.png`, fullPage: true });
  }
  await page.locator(".plan-backlog summary").click();
  await page.locator(".plan-backlog input:checked").first().uncheck();
  await page.getByRole("button", { name: "保存这份规划" }).waitFor();
  await page.getByRole("button", { name: "保存这份规划" }).click();
  await page.getByRole("button", { name: "已保存", exact: true }).waitFor();
  await noOverflow();
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.screenshot({ path: "demo/trial/mobile-action.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "demo/trial/desktop-action.png", fullPage: true });
  await page.getByRole("button", { name: "前往我的记录" }).click();
  await page.getByRole("heading", { name: "我的记录", exact: true }).waitFor();
  await page.getByRole("button", { name: "岗位库", exact: true }).click();
  await page.getByRole("button", { name: "依据", exact: true }).first().click();
  await page.getByText("匹配分构成", { exact: true }).waitFor();
  await page.getByRole("button", { name: "返回我的经历", exact: true }).click();
  assert.equal(await page.getByLabel("最近一件你认真做过的事").inputValue(), "");
  await page.getByLabel("最近一件你认真做过的事").fill("我用 Excel 整理了活动报名数据，并做了一份统计表。");
  await page.getByRole("button", { name: "拆开这段经历" }).click();
  assert.equal(await page.getByRole("button", { name: "带着这些能力，看看可能的方向" }).isDisabled(), true);
  const excelCandidate = page.locator(".card").filter({ has: page.getByText("Excel 数据处理", { exact: true }) }).filter({ has: page.getByRole("button", { name: "确认会", exact: true }) });
  await excelCandidate.getByRole("button", { name: "确认会", exact: true }).click();
  await page.getByRole("button", { name: "带着这些能力，看看可能的方向" }).click();
  await page.locator(".choice-detail").waitFor();
  assert.ok((await page.locator(".decision-facts").innerText()).includes("Excel 数据处理"));
  assert.deepEqual(errors, []);
  console.log("PASS: experience-first entry, fresh experience confirmation, source quote, diverse choices, selection, canvas pixels, first action, save/records, demo isolation, 320/390/1440/1920 layouts.");
} finally {
  await browser.close();
}
