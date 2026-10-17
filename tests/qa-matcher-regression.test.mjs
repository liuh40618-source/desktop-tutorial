import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { initKB, matchJob, buildPath, rankJobs, profileText, actionTemplate, buildGapMap } from "../lib/matcher.ts";

/**
 * QA 回归测试（D-10）：matcher 行为是否真的没变
 *
 * 结论前置（由 git diff 逐行核对得出，详见 QA 报告）：
 *  - rankJobs 函数体未变；
 *  - matchJob 分数公式数值等价（plusRate*100*0.15 === plusRate*15，trackRate*100*0.1 === trackRate*10）；
 *  - profileText 已变更（新增 p.experiences）；
 *  - buildPath 已变更（纳入 weakEvidence、排序改为权重优先）；
 *  - selectExplorations 为新增函数（HEAD 不存在）。
 * 本文件用最小 KB 锁定「向后兼容」这一硬性验收点。
 */
const skills = [
  { id: "sql", name: "SQL", category: "数据", aliases: ["sql"], estHours: 20, resources: [] },
  { id: "python", name: "Python", category: "数据", aliases: ["python"], estHours: 40, resources: [] },
  { id: "excel", name: "Excel", category: "数据", aliases: ["excel"], estHours: 10, resources: [] },
  { id: "git", name: "Git", category: "基础", aliases: ["git"], estHours: 8, resources: [] },
];
const jobs = [
  { id: "analyst", title: "Analyst", track: "data", summary: "分析", core: [{ s: "sql", w: 3 }, { s: "python", w: 2 }], plus: ["excel"], salary: { intern: "a", junior: "b" }, threshold: "", growth: "" },
  { id: "engineer", title: "Engineer", track: "eng", summary: "开发", core: [{ s: "python", w: 3 }, { s: "git", w: 1 }], plus: [], salary: { intern: "a", junior: "b" }, threshold: "", growth: "" },
];
const tracks = [{ id: "data", name: "Data" }, { id: "eng", name: "Eng" }];
// 最小 KB：仅 4 个必填字段，不含任何新增可选字段
const MINIMAL_KB = { skills, jobs, tracks, meta: { version: "test", note: "", salaryNote: "" } };

test("D10-1 最小 KB（不传新字段）initKB 后 matchJob/buildPath/rankJobs/buildGapMap 均可用", () => {
  initKB(MINIMAL_KB);
  assert.doesNotThrow(() => matchJob({ knownSkillIds: ["sql"] }, "analyst"));
  assert.doesNotThrow(() => buildPath({ knownSkillIds: ["sql"] }, "analyst"));
  assert.doesNotThrow(() => rankJobs({ knownSkillIds: ["sql"] }));
  assert.doesNotThrow(() => buildGapMap({ knownSkillIds: ["sql"] }, ["analyst", "engineer"]));
});

test("D10-2 分数公式数值等价于文档权重（覆盖率 75% + 加分项 15% + 方向契合 10%）", () => {
  initKB(MINIMAL_KB);
  const m = matchJob({ knownSkillIds: ["sql", "excel"] }, "analyst");
  // coverage: 3/(3+2)=60% ; plus 1/1=100% ; 方向未勾选 → trackRate=1
  assert.equal(m.coverage, 60);
  assert.equal(m.score, Math.round(60 * 0.75 + 1 * 15 + 1 * 10)); // 70
  assert.equal(m.scoreBreakdown.coverage, 60 * 0.75);
  assert.equal(m.scoreBreakdown.bonus, 15);
  assert.equal(m.scoreBreakdown.direction, 10);
});

test("D10-3 rankJobs 按分数降序（行为未变）", () => {
  initKB(MINIMAL_KB);
  const ranked = rankJobs({ knownSkillIds: ["python"] });
  for (let i = 1; i < ranked.length; i += 1) assert.ok(ranked[i - 1].score >= ranked[i].score, "rankJobs 未按分数降序");
});

test("D10-4 【行为已变更】profileText 现在纳入 experiences（HEAD 版本不含）", () => {
  initKB(MINIMAL_KB);
  const withExp = profileText({ major: "统计", experiences: "做过问卷调研", works: "" });
  assert.ok(withExp.includes("做过问卷调研"), "profileText 已纳入 experiences（与 PRD §6「profileText 行为不得改变」存在出入）");
  // 老字段顺序保持
  assert.ok(withExp.startsWith("统计"));
});

test("D10-5 【行为已变更】buildPath 现纳入 weakEvidence 项，且排序为「权重优先、其次性价比」", () => {
  initKB(MINIMAL_KB);
  const p = buildPath({ knownSkillIds: ["sql"], evidenceLevels: { sql: 1 }, hoursPerWeek: 10 }, "analyst");
  // sql 已掌握但证据等级<3 → 作为 kind='evidence' 进入行动清单（旧实现不会）
  assert.ok(p.some((x) => x.skillId === "sql" && x.kind === "evidence"), "buildPath 应纳入 weakEvidence（行为变更）");
  assert.ok(p.every((x) => x.deliverable && x.acceptance && Array.isArray(x.requiredElements)), "每项必须带交付物/验收/必含要素");
});

test("D10-6 actionTemplate 在最小 KB 下走通用兜底，仍非空", () => {
  initKB(MINIMAL_KB);
  const r = actionTemplate("sql", "SQL", "数据");
  assert.ok(r.deliverable && r.acceptance && r.deliverableType);
});

test("D10-7 真实数据下 actionTemplate 能解析出 requiredElements（非空）", () => {
  const skillsJson = JSON.parse(readFileSync(new URL("../data/skills.json", import.meta.url), "utf8"));
  const jobsJson = JSON.parse(readFileSync(new URL("../data/jobs.json", import.meta.url), "utf8"));
  const actionTemplates = JSON.parse(readFileSync(new URL("../data/action-templates.json", import.meta.url), "utf8"));
  const deliverableTypes = JSON.parse(readFileSync(new URL("../data/deliverable-types.json", import.meta.url), "utf8"));
  initKB({
    skills: skillsJson.skills,
    jobs: jobsJson.jobs,
    tracks: jobsJson.tracks,
    meta: { version: "3.2", note: "", salaryNote: "" },
    actionTemplates: { byCategory: actionTemplates.byCategory },
    deliverableTypes: { types: deliverableTypes.types },
  });
  const missing = skillsJson.skills.filter((s) => {
    const r = actionTemplate(s.id, s.name, s.category);
    return !r.deliverable || !r.acceptance || !r.requiredElements.length;
  }).map((s) => s.id);
  assert.deepEqual(missing, []);
});
