import assert from "node:assert/strict";
import { chromium } from "playwright";

/**
 * 容错与恢复验收（对齐当前「三章节 + 开场定位」版本）。
 *
 * 草稿通过 POST /api/profile 写入服务端（真实"老用户"路径），不直接写 localStorage——
 * 缓存键按访客会话分区（`zhitu_state_v2:<cacheScope>`），裸写会被忽略。
 *
 * 覆盖四条链路：
 *   1. 老草稿恢复 → 不显示开场门，直接落到「看见经历」并回填专业
 *   2. 示例体验隔离 → 进入示例不写个人草稿
 *   3. 保存接口 503 → 降级本地，记录可见并可改名
 *   4. 删除失败保留记录 + 恢复后清理
 */
const browser = await chromium.launch({ headless: true });
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:4000";

const DRAFT = {
  step: 0,
  started: true,
  selectedJobId: "",
  profile: {
    major: "Personal draft", grade: "", experiences: "SQL project", works: "", certificates: "",
    selfDescription: "", interests: "", knownSkillIds: ["sql"], customSkills: [], tempSkillIds: [],
    evidenceLevels: { sql: 2 }, targetTracks: [], hoursPerWeek: 8, goal: "", completedActions: [],
  },
};

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  let rejectPlansWrite = true;
  await page.route("**/api/plans**", (route) => {
    const method = route.request().method();
    const status = method === "GET" ? 200 : rejectPlansWrite ? 503 : 200;
    return route.fulfill({ status, json: method === "GET" ? [] : { ok: true } });
  });
  await page.route("**/api/jds", (route) => route.fulfill({ json: [] }));

  // 首次加载建立访客会话，随后写入服务端草稿
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const seeded = await page.evaluate(
    (draft) => fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }).then((r) => r.status),
    DRAFT,
  );
  assert.equal(seeded, 200, "服务端草稿写入应成功");

  await page.reload({ waitUntil: "networkidle" });

  // 1. 老草稿恢复：不显示开场门，直接到「看见经历」并回填
  await page.getByRole("button", { name: /记好了，去核对能力/ }).waitFor({ timeout: 15000 });
  assert.equal(await page.locator(".opening-gate").count(), 0, "有草稿时不应显示开场定位门");
  assert.equal(await page.getByLabel("专业").first().inputValue(), "Personal draft", "应恢复服务端草稿");

  // 2. 编辑草稿（保存接口仍可用，这里只验证界面不崩）
  await page.getByLabel("专业").first().fill("Updated personal draft");
  await page.waitForTimeout(1000);

  // 3. 示例体验：提示隔离，且保存规划不应写入个人草稿
  await page.getByRole("button", { name: /试一段示例/ }).click();
  await page.getByText("示例体验 · 不覆盖个人草稿").waitFor();
  await page.getByRole("button", { name: /记好了，去核对能力/ }).click();
  await page.getByRole("button", { name: "确认", exact: true }).first().click();
  await page.getByRole("button", { name: /带着这些能力，看看可能的方向/ }).click();
  await page.getByRole("button", { name: /就从这个方向试起/ }).click();
  await page.getByRole("button", { name: "生成下一步行动", exact: true }).click();
  await page.waitForTimeout(900);

  // 4. 保存接口 503 → 降级本地；记录可见
  await page.getByRole("button", { name: "保存这份规划", exact: true }).click();
  await page.getByRole("button", { name: "已保存", exact: true }).waitFor({ timeout: 12000 });
  const plansLen = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("zhitu_plans_v2:"));
    return key ? JSON.parse(localStorage.getItem(key) || "[]").length : 0;
  });
  assert.equal(plansLen, 1, "保存失败时应降级写入本地分区缓存");

  await page.getByRole("button", { name: /前往我的记录|我的记录/ }).last().click();
  await page.getByRole("button", { name: "改名", exact: true }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "改名", exact: true }).click();
  const rename = page.getByRole("textbox").last();
  await rename.fill("Offline plan");
  await rename.press("Enter");
  await page.getByText("Offline plan", { exact: true }).waitFor();

  // 5. 退出示例 → 个人草稿复原
  await page.getByRole("button", { name: /返回我的经历/ }).first().click();
  await page.waitForTimeout(700);
  assert.equal(await page.getByLabel("专业").first().inputValue(), "Updated personal draft", "退出示例应恢复个人草稿");

  // 6. 删除失败保留，恢复后清理
  await page.getByRole("navigation", { name: "辅助导航" }).getByRole("button", { name: "我的记录" }).click();
  await page.getByText("Offline plan", { exact: true }).waitFor();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("alert").getByText(/删除失败/).waitFor();
  assert.equal(await page.getByText("Offline plan", { exact: true }).count(), 1, "删除失败应保留记录");
  rejectPlansWrite = false;
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByText("还没有保存的规划", { exact: true }).waitFor({ timeout: 10000 });

  assert.deepEqual(errors, []);
  console.log("PASS: 草稿恢复、开场门抑制、示例隔离、离线保存/改名、删除失败保留与恢复后清理。");
} finally {
  await browser.close();
}
