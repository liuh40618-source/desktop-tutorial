import assert from "node:assert/strict";
import test from "node:test";
import { initKB, matchJob, buildPath, matchJdSkills, rankJobs, selectExplorations, detectSkills, detectSkillsDetailed, coverageLevel } from "../lib/matcher.ts";

const skills = [
  { id: "sql", name: "SQL", category: "data", aliases: ["sql"], estHours: 20, marketFrequency: 0.1, resources: [] },
  { id: "python", name: "Python", category: "data", aliases: ["python"], estHours: 40, marketFrequency: 0.9, resources: [] },
  { id: "excel", name: "Excel", category: "data", aliases: ["excel"], estHours: 10, resources: [] },
  { id: "java", name: "Java", category: "engineering", aliases: ["java"], estHours: 40, resources: [] },
  { id: "javascript", name: "JavaScript", category: "engineering", aliases: ["javascript"], estHours: 40, resources: [] },
];
const kb = { skills, jobs: [{ id: "analyst", title: "Analyst", track: "data", summary: "", core: [{ s: "sql", w: 3 }, { s: "python", w: 2 }], plus: ["excel"], salary: { intern: "", junior: "" }, threshold: "", growth: "" }], tracks: [{ id: "data", name: "Data" }], meta: { version: "test", note: "", salaryNote: "" } };
initKB(kb);

test("self-reported skills are not automatically project evidence", () => {
  const match = matchJob({ knownSkillIds: ["sql", "python"] }, "analyst");
  assert.equal(match.coverage, 100);
  assert.equal(match.evidenceCoverage, 0);
  assert.equal(match.supported.length, 0);
  assert.equal(match.weakEvidence.length, 2);
});

test("skill preselection uses shared token boundaries", () => {
  assert.deepEqual(detectSkills("JavaScript 和 NoSQL；Java 和 SQL"), ["sql", "java", "javascript"]);
});

test("skill preselection skips negated and uncertain mentions but keeps them reviewable", () => {
  const text = "不会使用 SQL；正在学习 Python";
  assert.deepEqual(detectSkills(text), []);
  assert.deepEqual(
    detectSkillsDetailed(text).map(({ id, cautionAliases }) => ({ id, cautionAliases })),
    [
      { id: "sql", cautionAliases: ["sql"] },
      { id: "python", cautionAliases: ["python"] },
    ]
  );
  assert.deepEqual(detectSkills("熟悉 SQL 和 Python"), ["sql", "python"]);
});

test("evidence coverage counts only known skills with project-level self-report", () => {
  const match = matchJob({ knownSkillIds: ["sql", "python"], evidenceLevels: { sql: 3, python: 2 } }, "analyst");
  assert.equal(match.evidenceCoverage, 60);
  assert.equal(match.supported[0].id, "sql");
  const stale = matchJob({ knownSkillIds: [], evidenceLevels: { sql: 5 } }, "analyst");
  assert.equal(stale.evidenceCoverage, 0);
});

test("score breakdown exactly reproduces the total without invented scarcity points", () => {
  const match = matchJob({ knownSkillIds: ["sql", "excel"] }, "analyst");
  assert.equal(match.coverage, 60);
  assert.equal(match.score, 70);
  assert.equal(Math.round(Object.values(match.scoreBreakdown).reduce((a, b) => a + b, 0)), match.score);
  assert.equal(match.scarcityBonus, 0);
});

test("actions include weak evidence and have deliverables and acceptance criteria", () => {
  const path = buildPath({ knownSkillIds: ["sql"], evidenceLevels: { sql: 1 }, hoursPerWeek: 10 }, "analyst");
  assert.equal(path.length, 2);
  assert.equal(path[0].skillId, "sql");
  assert.equal(path[0].kind, "evidence");
  assert.equal(path[1].kind, "learn");
  assert.equal(path[0].estHours, 4);
  assert.equal(path[1].cumulativeWeeks, 4.4);
  assert.ok(path.every((p) => p.deliverable && p.acceptance && Number.isFinite(p.priority)));
});

test("fully supported skills need no redundant actions", () => {
  assert.deepEqual(buildPath({ knownSkillIds: ["sql", "python"], evidenceLevels: { sql: 3, python: 4 } }, "analyst"), []);
});

test("JD coverage ignores duplicates and unknown skill ids", () => {
  const match = matchJdSkills({ knownSkillIds: ["sql"] }, ["sql", "sql", "missing"]);
  assert.equal(match.coverage, 100);
  assert.equal(match.covered.length, 1);
  assert.equal(match.gapHours, 0);
});

test("knowledge initialization makes rankings available", () => {
  assert.equal(rankJobs({}).length, 1);
});

test("exploration choices explain different directions without duplicates", () => {
  const base = matchJob({ knownSkillIds: ["sql"] }, "analyst");
  const matches = [base, { ...base, jobId: "data-two" }, { ...base, jobId: "web", track: "web" }, { ...base, jobId: "design", track: "design" }];
  const choices = selectExplorations(matches, ["web"]);
  assert.deepEqual(choices.map((c) => c.match.jobId), ["analyst", "web", "design"]);
  assert.equal(new Set(choices.map((c) => c.match.track)).size, 3);
  assert.ok(choices.every((c) => c.label && c.reason));
});

test("exploration never invents three choices or recommends zero-overlap jobs", () => {
  assert.deepEqual(selectExplorations(rankJobs({})), []);
  const base = matchJob({ knownSkillIds: ["sql"] }, "analyst");
  assert.equal(selectExplorations([base, { ...base, jobId: "same-track" }]).length, 1);
  const other = { ...base, jobId: "web", track: "web" };
  assert.deepEqual(selectExplorations([base, other], ["unknown"]).map((c) => c.match.jobId), ["analyst", "web"]);
});

test("coverageLevel 覆盖四档边界（与开场定位同一套阈值，禁止百分比）", () => {
  assert.equal(coverageLevel(100), "高");
  assert.equal(coverageLevel(70), "高");
  assert.equal(coverageLevel(69), "中高");
  assert.equal(coverageLevel(40), "中高");
  assert.equal(coverageLevel(39), "中");
  assert.equal(coverageLevel(20), "中");
  assert.equal(coverageLevel(19), "低");
  assert.equal(coverageLevel(0), "低");
  assert.equal(coverageLevel(Number.NaN), "低");
});

test("rankJobs 排序键显式化：技能覆盖 → 方向契合 → 加分项（不再由不展示的总分驱动）", () => {
  initKB({
    skills: [
      { id: "x", name: "X", category: "c", aliases: ["x"], estHours: 10, resources: [] },
      { id: "y", name: "Y", category: "c", aliases: ["y"], estHours: 10, resources: [] },
      { id: "z", name: "Z", category: "c", aliases: ["z"], estHours: 10, resources: [] },
      { id: "w2", name: "W2", category: "c", aliases: ["w2"], estHours: 10, resources: [] },
      { id: "p", name: "P", category: "c", aliases: ["p"], estHours: 10, resources: [] },
    ],
    jobs: [
      { id: "jobA", title: "A", track: "t1", summary: "", core: [{ s: "x", w: 8 }, { s: "y", w: 2 }], plus: [], salary: { intern: "", junior: "" }, threshold: "", growth: "" },
      { id: "jobB", title: "B", track: "t2", summary: "", core: [{ s: "z", w: 3 }, { s: "w2", w: 2 }], plus: ["p"], salary: { intern: "", junior: "" }, threshold: "", growth: "" },
    ],
    tracks: [{ id: "t1", name: "T1" }, { id: "t2", name: "T2" }],
    meta: { version: "test", note: "", salaryNote: "" },
  });
  const ranked = rankJobs({ knownSkillIds: ["x", "z", "p"], targetTracks: ["t2"] }, 10);
  assert.deepEqual(ranked.map((m) => m.jobId), ["jobA", "jobB"]);
  assert.equal(ranked[0].coverage, 80);
  assert.equal(ranked[1].coverage, 60);
  assert.equal(ranked[0].trackFit, 0.5);
  assert.equal(ranked[1].trackFit, 1);
  assert.equal(ranked[1].plusRate, 1);
  // 旧实现按合成总分降序：本例 jobB(70) 会排在 jobA(65) 之前——新排序键与之不同
  assert.ok(ranked[0].score < ranked[1].score, "新排序键应与旧合成总分排序不同（本例总分 jobB 更高）");
});
