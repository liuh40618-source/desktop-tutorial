import assert from "node:assert/strict";
import { chromium } from "playwright";

/**
 * 端到端市场可用性验证：以真实用户视角走完三章节主流程 + 关键页面。
 * 对齐当前版本（三章节 + 开场定位），不依赖已脱节的 verify-workspace.mjs 选择器。
 */
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:4000";
const browser = await chromium.launch({ headless: true });
const steps = [];
const ok = (name) => steps.push(["PASS", name]);
const bad = (name, why) => steps.push(["FAIL", name, why]);
const errors = [];

async function run(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    bad(name, e.message.split("\n")[0]);
  }
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (!t.includes("favicon")) errors.push(`console: ${t.slice(0, 160)}`);
    }
  });

  // 1. 根路径 → /plan，页脚数据口径正确
  await run("入口：根路径跳转到 /plan 且数据口径为 579/17/v3.7", async () => {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByText("开场定位", { exact: false }).first().waitFor({ timeout: 15000 });
    const body = await page.locator("body").innerText();
    assert.ok(body.includes("579"), "首页应展示 579 岗");
    assert.ok(body.includes("17"), "首页应展示 17 方向");
    assert.ok(body.includes("3.7"), "首页应展示数据版本 3.7");
    assert.ok(!body.includes("133 岗"), "不应残留 133 岗旧口径");
    assert.ok(!body.includes("13 个方向") && !body.includes("13 方向"), "不应残留 13 方向旧口径");
  });

  // 2. 开场定位可跳过并进入主流程
  await run("开场定位：可跳过并进入「看见经历」", async () => {
    const skip = page.getByRole("button", { name: /直接选方向/ });
    if (await skip.count()) {
      await skip.first().click();
    } else {
      await page.getByRole("button", { name: /跳过/ }).first().click();
    }
    await page.getByRole("button", { name: /记好了，去核对能力/ }).waitFor({ timeout: 10000 });
  });

  // 3. 结构化填写经历 → 去核对能力
  await run("01 看见经历：结构化填写后可用「记好了，去核对能力」推进", async () => {
    await page.getByLabel("你做过什么？").fill("为社团办了一次活动报名数据统计");
    await page.getByLabel("你负责哪个部分？").fill("我负责回收并整理全部报名数据");
    await page.getByLabel("用了什么工具或方法？").fill("Excel、剔除无效数据、分类统计");
    await page.getByLabel("做出了什么结果？").fill("整理出有效报名记录并输出分类统计表");
    const next = page.getByRole("button", { name: /记好了，去核对能力/ });
    assert.equal(await next.isDisabled(), false, "填写后按钮应可点击");
    await next.click();
    await page.waitForTimeout(1800);
    const body = await page.locator("body").innerText();
    assert.ok(/Excel|数据处理|候选|确认会|能力/.test(body), "核对页应出现技能候选");
  });

  // 4. 岗位库：总数正确、搜索可用
  await run("岗位库：总数 579、搜索与筛选可用", async () => {
    await page.getByRole("button", { name: "岗位库", exact: true }).click();
    const search = page.getByRole("textbox", { name: "搜索岗位、方向或技能" });
    await search.waitFor({ timeout: 10000 });
    const status = page.getByRole("status").filter({ hasText: "岗位模板" });
    assert.match(await status.innerText(), /显示 579 \/ 579/, "岗位库总数应为 579");
    await search.fill("Python");
    await page.waitForTimeout(600);
    assert.match(await status.innerText(), /显示 [1-9]\d* \//, "搜索应返回结果");
    await page.getByRole("button", { name: "清空搜索", exact: true }).click();
  });

  // 5. /submit 提交中心：真实队长信息与包名
  await run("/submit：渲染队长队长 / [请填写联系电话] / 职途+队长.zip", async () => {
    await page.goto(`${base}/submit`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    assert.ok(body.includes("队长"), "提交页应显示队长姓名队长");
    assert.ok(body.includes("[请填写联系电话]"), "提交页应显示队长电话");
    assert.ok(body.includes("职途+队长.zip"), "提交页应显示真实压缩包名");
    assert.ok(body.includes("marketing@newtouch.com"), "提交页应显示收件邮箱");
    assert.ok(!body.includes("项目名称+队长姓名"), "不应残留占位符包名");
    assert.ok(!body.includes("待填"), "不应残留待填占位");
  });

  // 6. /market 知识库观察
  await run("/market：知识库观察页正常渲染", async () => {
    await page.goto(`${base}/market`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    assert.ok(body.includes("579"), "/market 应显示 579 岗");
    assert.ok(body.includes("134"), "/market 应显示 134 技能");
    assert.ok(!body.includes("133"), "/market 不应残留 133");
    assert.ok(!body.includes("109"), "/market 不应残留 109 技能");
  });

  // 7. /admin 不再暴露裸 503
  await run("/admin：未配 ADMIN_TOKEN 时重定向回 /plan 而非裸错误页", async () => {
    const resp = await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const body = await page.locator("body").innerText();
    assert.ok(!body.includes("管理后台暂未启用"), "不应显示裸 503 文本页");
    assert.ok(page.url().includes("/plan"), `应重定向到 /plan，实际 ${page.url()}`);
    assert.ok(body.includes("管理后台未启用"), "应在页面上如实告知后台未启用");
  });

  // 8. 移动端无横向溢出
  await run("响应式：390px 无横向溢出", async () => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${base}/plan`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, "390px 下不应横向溢出");
  });

  console.log("\n=== 端到端验证结果 ===");
  for (const [state, name, why] of steps) {
    console.log(`${state === "PASS" ? "✓" : "✗"} ${name}${why ? `\n    → ${why}` : ""}`);
  }
  const failed = steps.filter((s) => s[0] === "FAIL");
  console.log(`\n通过 ${steps.length - failed.length}/${steps.length}`);
  if (errors.length) {
    console.log("\n浏览器错误：");
    for (const e of [...new Set(errors)]) console.log(`  · ${e}`);
  } else {
    console.log("浏览器错误：无");
  }
  process.exit(failed.length > 0 ? 1 : 0);
} finally {
  await browser.close();
}
