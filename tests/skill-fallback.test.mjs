import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { ALIAS_GROUPS, findSkillFallback } from "../lib/skill-fallback.mjs";
import { findSkillAliasOccurrences } from "../lib/skill-matching.mjs";

const skills = [
  { id: "sql", name: "SQL 查询与取数", aliases: ["sql", "mysql"] },
  { id: "data-viz", name: "数据可视化", aliases: ["可视化", "图表"] },
  { id: "user-research", name: "用户研究", aliases: ["用户调研", "访谈"] },
  { id: "db-design", name: "数据库设计", aliases: ["建模"] },
  { id: "kafka", name: "Kafka", aliases: ["kafka"] },
  { id: "java", name: "Java", aliases: ["java"] },
  { id: "javascript", name: "JavaScript", aliases: ["javascript"] },
  { id: "nosql", name: "NoSQL", aliases: ["nosql"] },
];

test("别名组命中（取数 → sql）", () => {
  const hits = findSkillFallback("我平时主要负责取数", skills);
  const hit = hits.find((h) => h.id === "sql");
  assert.ok(hit);
  assert.equal(hit.source, "alias-group");
  assert.equal(hit.confidence, "high");
  assert.ok(ALIAS_GROUPS.some((g) => g.canonical === "sql"));
});

test("子串命中（拉丁别名 + 词边界 + 长度 ≥4）", () => {
  const hit = findSkillFallback("用过 kafka 做消息队列", skills).find((h) => h.id === "kafka");
  assert.ok(hit);
  assert.equal(hit.source, "substring");
  assert.equal(hit.confidence, "medium");
});

test("中文 substring 已移除：2 字泛性别名不得再被长词命中", () => {
  assert.deepEqual(findSkillFallback("参加过数学建模比赛", skills), []);
  assert.deepEqual(findSkillFallback("做过一些用户调研的工作", skills), []);
});

test("fuzzy 命中拼写近似（javascrpit → javascript）", () => {
  const hits = findSkillFallback("熟悉 javascrpit 语法", skills);
  const hit = hits.find((h) => h.id === "javascript");
  assert.ok(hit);
  assert.equal(hit.source, "fuzzy");
  assert.equal(hit.confidence, "low");
});

test("java 与 javascript 不得互相 fuzzy 命中", () => {
  assert.deepEqual(findSkillFallback("java", skills).filter((h) => h.source === "fuzzy"), []);
  assert.deepEqual(findSkillFallback("javascript", skills).filter((h) => h.source === "fuzzy"), []);
  assert.ok(!findSkillFallback("我只用过 java", skills).some((h) => h.id === "javascript"));
});

test("sql 不得命中 nosql（子串与 fuzzy 双重防护）", () => {
  const hits = findSkillFallback("写过 nosql", skills);
  assert.ok(!hits.some((h) => h.id === "sql"));
});

test("只返回库内 id，且只提候选（无副作用）", () => {
  const before = JSON.stringify(skills);
  const hits = findSkillFallback("取数 javascrpit 可视化", skills);
  assert.ok(hits.every((h) => skills.some((s) => s.id === h.id)));
  assert.equal(JSON.stringify(skills), before);
});

test("空 / 非法输入安全", () => {
  assert.deepEqual(findSkillFallback("", skills), []);
  assert.deepEqual(findSkillFallback("取数", []), []);
  assert.deepEqual(findSkillFallback(null, null), []);
});

/* ============================================================
   QA 对抗性验证反例（用真实 data/skills.json，非合成 KB）
   ============================================================ */
const realSkills = JSON.parse(fs.readFileSync(new URL("../data/skills.json", import.meta.url), "utf8")).skills;

const QA_CASES = [
  ["我用 sql 做过取数", ["cpp", "llm-api", "growth", "security-ops", "sre-basics", "seo-basics"]],
  ["用过 k8s 部署", ["node"]],
  ["调 OpenAI 的接口", ["cv-basics"]],
  ["负责 http 接口联调", ["html-css"]],
  ["做过 css 布局", ["dl-framework", "cloud-sec", "unreal", "system-design", "cpp"]],
  ["只关心 roi", ["rag", "embedded", "grpc"]],
];

test("QA 反例：fuzzy 收紧后不再跨技能误命中", () => {
  const failures = [];
  for (const [text, forbidden] of QA_CASES) {
    for (const hit of findSkillFallback(text, realSkills)) {
      if (forbidden.includes(hit.id)) failures.push(`${text} -> ${hit.id}(${hit.source})`);
    }
  }
  assert.deepEqual(failures, []);
});

test("收紧后仍能救回真实拼写错误（javascirpt → js）", () => {
  const hit = findSkillFallback("熟悉 javascirpt 语法", realSkills).find((h) => h.id === "js");
  assert.ok(hit, "javascirpt 应命中 js");
  assert.equal(hit.source, "fuzzy");
});

test("系统性跨技能误命中回归护栏：fuzzy 层为 0", () => {
  let fuzzyFalseHits = 0;
  for (const skill of realSkills) {
    const input = [skill.name, ...(skill.aliases || [])].join(" ");
    fuzzyFalseHits += findSkillFallback(input, realSkills).filter(
      (h) => h.id !== skill.id && h.source === "fuzzy"
    ).length;
  }
  assert.equal(fuzzyFalseHits, 0);
});

/* ============================================================
   T04.6：中文泛词 substring 误命中（真实语料）
   ============================================================ */
const LAYER2_NEGATIVE = [
  ["参加过数学建模比赛，负责建模和写论文", ["db-design"]],
  ["做过课程设计，用 Java 写了一个图书管理系统", ["prototype"]],
  ["负责实验室的服务器维护和网络排查", ["ab-test", "network-sec", "network-basics"]],
];

test("第二层 substring：中文泛词不再跨技能误命中（真实语料）", () => {
  const failures = [];
  for (const [text, forbidden] of LAYER2_NEGATIVE) {
    for (const hit of findSkillFallback(text, realSkills)) {
      if (forbidden.includes(hit.id)) failures.push(`${text} -> ${hit.id}(${hit.source})`);
    }
  }
  assert.deepEqual(failures, []);
});

test("第二层不再产生任何中文 substring 命中", () => {
  const samples = ["数学建模", "课程设计", "实验室", "网络排查", "需求文档", "竞品分析", "服务器维护", "数据库设计"];
  const bad = [];
  for (const text of samples) {
    for (const hit of findSkillFallback(text, realSkills)) {
      if (hit.source === "substring") bad.push(`${text}->${hit.id}`);
    }
  }
  assert.deepEqual(bad, []);
});

/** 第一层 ∪ 第二层：证明「没收死」（第一层是主路径） */
function detectCombined(text) {
  const ids = new Set();
  for (const skill of realSkills) {
    if ((skill.aliases || []).some((alias) => findSkillAliasOccurrences(text, alias).some((o) => !o.negated && !o.uncertain))) {
      ids.add(skill.id);
    }
  }
  for (const hit of findSkillFallback(text, realSkills)) ids.add(hit.id);
  return [...ids];
}

test("正向：真实语料仍能被识别（第一层 ∪ 第二层）", () => {
  const questionnaire = detectCombined("帮老师做了一个问卷，用 Python 清洗数据并画了图表");
  assert.ok(questionnaire.includes("data-clean"), questionnaire.join(","));
  assert.ok(questionnaire.includes("data-viz"), questionnaire.join(","));

  const internship = detectCombined("在实习时跟着同事做需求文档和竞品分析");
  assert.ok(internship.includes("prd"), internship.join(","));
  assert.ok(internship.includes("doc-writing"), internship.join(","));
});

/* ============================================================
   T04.7：别名泛词清理后的「第一层」回归（数据修复）
   ============================================================ */
const LAYER1_FIXED = [
  ["参加过数学建模比赛，负责建模和写论文", ["db-design"]],
  ["做过课程设计，用 Java 写了一个图书管理系统", ["prototype"]],
  ["负责实验室的服务器维护和网络排查", ["ab-test", "network-sec", "network-basics"]],
  ["负责网络排查", ["network-sec", "network-basics"]],
];

test("T04.7 第一层回归：泛词限定化/删除后不再跨域误命中", () => {
  const failures = [];
  for (const [text, forbidden] of LAYER1_FIXED) {
    for (const id of detectCombined(text)) {
      if (forbidden.includes(id)) failures.push(`${text} -> ${id}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("T04.7 正向召回未受损（第一层 ∪ 第二层）", () => {
  const excelStats = detectCombined("用 Excel 做了一份统计表");
  assert.ok(excelStats.includes("excel"), excelStats.join(","));
  assert.ok(excelStats.includes("stats"), excelStats.join(","));
});
