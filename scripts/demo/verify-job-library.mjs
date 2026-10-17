import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

// 岗位总数从数据文件读，避免硬编码数字随知识库扩档而过期
const JOB_TOTAL = JSON.parse(readFileSync(new URL("../../data/jobs.json", import.meta.url), "utf8")).jobs.length;

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:4000";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/profile**", (route) => route.fulfill({ json: null }));
  await page.route("**/api/jds", (route) => route.fulfill({ json: [] }));
  await page.goto(`${base}/plan`);
  await page.getByRole("button", { name: "岗位库", exact: true }).click();
  const search = page.getByRole("textbox", { name: "搜索岗位、方向或技能" });
  await search.waitFor();
  const status = page.getByRole("status").filter({ hasText: "岗位模板" });
  assert.match(await status.innerText(), new RegExp(`显示 ${JOB_TOTAL} / ${JOB_TOTAL}`));
  await search.fill("Python");
  // 翻页控件：上一批 / 下一批 + 「第 N / M 批 · 共 X 个岗位」文本
  await page.getByRole("button", { name: "下一批", exact: true }).click();
  await page.getByText(/第 \d+ \/ \d+ 批 · 共 \d+ 个岗位/).waitFor();
  const count = Number((await status.innerText()).match(/显示 (\d+)/)[1]);
  assert.ok(count > 0 && count < JOB_TOTAL);
  await page.getByText("当前条件：关键词“Python”", { exact: true }).waitFor();
  await page.getByRole("button", { name: "清空搜索", exact: true }).click();
  assert.equal(await search.inputValue(), "");
  assert.match(await status.innerText(), new RegExp(`显示 ${JOB_TOTAL} / ${JOB_TOTAL}`));
  await search.fill("zzzz-no-such-job");
  await page.getByText("没有符合当前条件的岗位模板。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /下一批/ }).count(), 0);
  await page.getByRole("button", { name: "清除筛选", exact: true }).first().click();
  assert.match(await status.innerText(), new RegExp(`显示 ${JOB_TOTAL} / ${JOB_TOTAL}`));
  await page.getByRole("combobox", { name: "方向", exact: true }).selectOption("frontend");
  const directionCount = Number((await status.innerText()).match(/显示 (\d+)/)[1]);
  assert.ok(directionCount > 0 && directionCount < JOB_TOTAL);
  await page.getByRole("combobox", { name: "技能缺口" }).selectOption("ready");
  await page.getByText("没有符合当前条件的岗位模板。", { exact: true }).waitFor();
  await page.getByRole("combobox", { name: "技能缺口" }).selectOption("hard");
  assert.ok(Number((await status.innerText()).match(/显示 (\d+)/)[1]) > 0);
  await page.getByRole("combobox", { name: "排序", exact: true }).selectOption("gap");
   const gaps = await page.locator(".library-page .space-y-3 > div").evaluateAll((cards) => cards.map((card) => Number(card.textContent?.match(/待补齐 (\d+) 项/)?.[1] ?? NaN)).filter(Number.isFinite));
   assert.ok(gaps.length > 1, "sorted results should expose multiple job cards");
   assert.deepEqual(gaps, [...gaps].sort((a, b) => a - b));
  await mkdir("demo/job-library", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `demo/job-library/library-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "清除筛选", exact: true }).first().click();
  await page.getByRole("button", { name: "选它 · 看差距", exact: true }).first().click();
  await page.getByRole("heading", { name: "先确认能力与目标岗位，再生成行动计划" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: full-library search, pagination reset, empty state, combined filters, sorting, mobile layouts and selection guard.");
} finally {
  await browser.close();
}
