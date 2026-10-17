import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveActionTemplate } from "../lib/action-template.mjs";
import { initKB, actionTemplate } from "../lib/matcher.ts";

/**
 * QA 对抗性测试（C-9）：action-template 四级解析 —— 109 技能逐个验证（P0-14 硬指标）
 */
const skillsJson = JSON.parse(readFileSync(new URL("../data/skills.json", import.meta.url), "utf8"));
const jobsJson = JSON.parse(readFileSync(new URL("../data/jobs.json", import.meta.url), "utf8"));
const actionTemplates = JSON.parse(readFileSync(new URL("../data/action-templates.json", import.meta.url), "utf8")).byCategory;
const deliverableTypes = JSON.parse(readFileSync(new URL("../data/deliverable-types.json", import.meta.url), "utf8")).types;
const SKILLS = skillsJson.skills;

test("C9-1 109 个技能 100% 解析出非空 deliverable + acceptance + requiredElements", () => {
  const bad = [];
  for (const sk of SKILLS) {
    const r = resolveActionTemplate(sk, actionTemplates, deliverableTypes);
    if (!r.deliverable || !r.acceptance || !r.requiredElements.length) bad.push(`${sk.id}: ${JSON.stringify(r)}`);
  }
  assert.deepEqual(bad, [], `未能解析的技能: ${bad.join(" | ")}`);
});

test("C9-2 skill.action 存在时优先于分类默认（7 个覆盖技能逐条核对）", () => {
  const covered = SKILLS.filter((s) => s.action);
  assert.equal(covered.length, 7);
  for (const sk of covered) {
    const r = resolveActionTemplate(sk, actionTemplates, deliverableTypes);
    assert.equal(r.deliverable, sk.action.deliverable, `${sk.id} 应使用技能级 deliverable`);
    assert.equal(r.acceptance, sk.action.acceptance, `${sk.id} 应使用技能级 acceptance`);
    assert.equal(r.deliverableType, sk.action.deliverableType, `${sk.id} 应使用技能级 deliverableType`);
    const catTpl = actionTemplates[sk.category];
    if (catTpl) assert.notEqual(r.deliverable, catTpl.deliverable, `${sk.id} 不应回落到分类模板`);
  }
});

test("C9-3 {skill} 占位符在分类默认模板中被正确替换为技能名", () => {
  const noAction = SKILLS.filter((s) => !s.action);
  let checked = 0;
  for (const sk of noAction) {
    const catTpl = actionTemplates[sk.category];
    if (!catTpl || !catTpl.deliverable.includes("{skill}")) continue;
    const r = resolveActionTemplate(sk, actionTemplates, deliverableTypes);
    assert.ok(!r.deliverable.includes("{skill}"), `${sk.id} 的 deliverable 仍残留占位符`);
    assert.ok(r.deliverable.includes(sk.name), `${sk.id} 的 deliverable 应包含技能名「${sk.name}」`);
    checked += 1;
  }
  assert.ok(checked > 50, `应覆盖大多数无 action 技能，实际 ${checked}`);
});

test("C9-4 matcher.actionTemplate 与共享模块 resolveActionTemplate 输出一致（禁止两份实现）", () => {
  initKB({
    skills: SKILLS,
    jobs: jobsJson.jobs,
    tracks: jobsJson.tracks,
    meta: { version: "3.2", note: "", salaryNote: "" },
    actionTemplates: { byCategory: actionTemplates },
    deliverableTypes: { types: deliverableTypes },
  });
  const mismatched = [];
  for (const sk of SKILLS) {
    const a = resolveActionTemplate(sk, actionTemplates, deliverableTypes);
    const b = actionTemplate(sk.id, sk.name, sk.category);
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatched.push(`${sk.id}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
  assert.deepEqual(mismatched, []);
});

test("C9-5 半成品 action（缺 acceptance）应安全回落到分类默认，不得产出空 acceptance", () => {
  const half = { id: "x", name: "X", category: "数据", action: { deliverableType: "report", deliverable: "半成品" } };
  const r = resolveActionTemplate(half, actionTemplates, deliverableTypes);
  assert.ok(r.acceptance && r.acceptance.trim().length > 0, "acceptance 不得为空");
  assert.ok(r.deliverable && r.deliverable.trim().length > 0);
});

test("C9-6 完全无 KB（无 byCategory / deliverableTypes）时通用兜底永不为空", () => {
  for (const sk of SKILLS.slice(0, 20)) {
    const r = resolveActionTemplate({ id: sk.id, name: sk.name, category: sk.category }, {}, {});
    assert.ok(r.deliverable && r.acceptance && r.deliverableType);
  }
  const noName = resolveActionTemplate({ id: "orphan" }, {}, {});
  assert.ok(noName.deliverable.length > 0 && noName.acceptance.length > 0);
  assert.doesNotThrow(() => resolveActionTemplate(null, null, null));
});

test("C9-7 deliverableType 解析顺序：技能级 → 分类 → other", () => {
  const withType = resolveActionTemplate({ id: "a", name: "A", category: "数据", action: { deliverableType: "doc", deliverable: "d", acceptance: "a" } }, actionTemplates, deliverableTypes);
  assert.equal(withType.deliverableType, "doc");
  const catOnly = resolveActionTemplate({ id: "b", name: "B", category: "前端" }, actionTemplates, deliverableTypes);
  assert.equal(catOnly.deliverableType, actionTemplates["前端"].deliverableType);
  const none = resolveActionTemplate({ id: "c", name: "C", category: "不存在" }, actionTemplates, deliverableTypes);
  assert.equal(none.deliverableType, "other");
});
