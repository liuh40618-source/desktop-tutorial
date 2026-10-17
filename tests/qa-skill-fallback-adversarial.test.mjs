import assert from "node:assert/strict";
import test from "node:test";
import { findSkillFallback } from "../lib/skill-fallback.mjs";
import { readFileSync } from "node:fs";

/**
 * QA 对抗性测试（C-6）：skill-fallback 误命中
 *
 * 判定：任何「跨技能」的误命中都是缺陷 —— 用户描述技能 A，却候选出技能 B。
 * 已知被工程师修过的案例（java↔javascript、mysql↔nosql）必须仍然安全。
 * 本文件同时固化了 QA 新发现的误命中矩阵，作为回归基线。
 */
const skillsJson = JSON.parse(readFileSync(new URL("../data/skills.json", import.meta.url), "utf8"));
const SKILLS = skillsJson.skills.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases || [] }));
const run = (text) => findSkillFallback(text, SKILLS);
const ids = (text) => run(text).map((h) => h.id);

test("C6-1 工程师已修的案例仍然安全（java≠javascript、mysql≠nosql）", () => {
  assert.ok(!ids("我用过 javascript").includes("java"), "javascript 不应命中 java");
  assert.ok(!ids("我用过 java").includes("javascript"), "java 不应命中 javascript");
  assert.ok(!ids("我会 mysql").includes("nosql"), "mysql 不应命中 nosql");
});

test("C6-2 任务点名的 6 组疑似绕过案例，均不得跨技能误命中", () => {
  assert.deepEqual(ids("我用 sqlite 存数据"), [], "sqlite 不应命中 sql");
  assert.deepEqual(ids("用 reactor 模式做后端"), [], "reactor 不应命中 react/spa-framework");
  assert.deepEqual(ids("管理 nodes 集群"), [], "nodes 不应命中 node");
  assert.deepEqual(ids("用 scss 编译"), [], "scss 不应命中 css（也应注意 data-clean 别名「预处理」会干扰含该词的句子）");
  assert.deepEqual(ids("会写 golang"), [], "golang 的精确别名应由第一层处理，fallback 不应重复命中");
  assert.deepEqual(ids("写 ts 和 tests"), [], "ts/tests 不应命中任何技能");
});

test("C6-3 【QA 新发现】短拉丁别名 fuzzy 跨技能误命中：sql 会连带命中 6 个无关技能", () => {
  const hit = ids("我用 sql 做过取数");
  const foreign = hit.filter((id) => id !== "sql");
  // 期望：只有 sql（以及别名组 canonical）合理；不得牵连 cpp/llm-api/growth/security-ops/sre-basics/seo-basics
  assert.deepEqual(foreign, [], `「我用 sql 做过取数」误命中: ${foreign.join(", ")}`);
});

test("C6-4 【QA 新发现】css 会误命中 5 个无关技能", () => {
  const foreign = ids("做过 css 布局").filter((id) => id !== "html-css");
  assert.deepEqual(foreign, [], `「做过 css 布局」误命中: ${foreign.join(", ")}`);
});

test("C6-5 【QA 新发现】k8s 误命中 node；roi 误命中 rag/embedded/grpc", () => {
  assert.deepEqual(ids("用过 k8s 部署"), [], `「用过 k8s 部署」误命中: ${ids("用过 k8s 部署").join(", ")}`);
  assert.deepEqual(ids("管理预算与 roi"), [], `「管理预算与 roi」误命中: ${ids("管理预算与 roi").join(", ")}`);
});

test("C6-6 【QA 新发现】http 误命中 html-css；openai 误命中 cv-basics", () => {
  assert.ok(!ids("负责 http 接口联调").includes("html-css"), "http 不应命中 html-css");
  assert.ok(!ids("调 OpenAI 的接口").includes("cv-basics"), "OpenAI 不应命中 cv-basics(opencv)");
});

test("C6-7 空 / 非法输入安全，且只返回库内 id", () => {
  assert.deepEqual(findSkillFallback("", SKILLS), []);
  assert.deepEqual(findSkillFallback(null, SKILLS), []);
  assert.deepEqual(findSkillFallback(undefined, SKILLS), []);
  assert.deepEqual(findSkillFallback("取数", []), []);
  assert.deepEqual(findSkillFallback(123, SKILLS), []);
  const known = new Set(SKILLS.map((s) => s.id));
  for (const h of run("我会 sql、python、写文档、做图、排期")) assert.ok(known.has(h.id), `${h.id} 不在库内`);
});

test("C6-8 别名组（alias-group）应正确命中 canonical", () => {
  assert.ok(ids("我负责取数和拉数").includes("sql"));
  assert.ok(ids("经常做图表看板").includes("data-viz"));
  assert.ok(ids("我负责写方案、写报告").includes("doc-writing"));
});
