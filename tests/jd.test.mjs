import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJdText, parseJdText } from "../lib/jd.ts";
import { containsSkillAlias } from "../lib/skill-matching.mjs";

test("normalizeJdText removes headings/noise and normalizes line endings", () => {
  const result = normalizeJdText("\uFEFF岗位职责：\r\n\r\n  熟悉 SQL   和 Python  \r\n---\r\n");
  assert.equal(result.text, "熟悉 SQL 和 Python");
  assert.equal(result.truncated, false);
});

test("parseJdText returns unique rule matches and alias evidence", () => {
  const result = parseJdText("熟悉关系型数据库，使用 Python 和 SQL 完成分析", [
    { id: "python", name: "Python", aliases: ["python"] },
    { id: "sql", name: "SQL", aliases: ["sql", "关系型数据库"] },
  ]);
  assert.deepEqual(result.skills, ["python", "sql"]);
  assert.deepEqual(result.skillSources[1].matchedAliases, ["SQL", "关系型数据库"]);
});

test("parseJdText avoids matching sql inside a longer latin token", () => {
  const result = parseJdText("需要掌握 postgresql 数据库", [
    { id: "sql", name: "SQL", aliases: ["sql"] },
  ]);
  assert.deepEqual(result.skills, []);
});

test("shared alias boundaries distinguish Java from JavaScript and SQL from NoSQL", () => {
  const result = parseJdText("JavaScript 和 NoSQL 是加分项；熟悉 Java 和 SQL", [
    { id: "javascript", name: "JavaScript", aliases: ["javascript"] },
    { id: "java", name: "Java", aliases: ["java"] },
    { id: "sql", name: "SQL", aliases: ["sql"] },
  ]);

  assert.deepEqual(result.skills, ["javascript", "java", "sql"]);
  assert.equal(containsSkillAlias("C++", "C"), false);
  assert.equal(containsSkillAlias("C++", "C++"), true);
});

test("parseJdText marks negated and uncertain mentions for review", () => {
  const result = parseJdText("不会使用 SQL；正在学习 Python；Java 不熟悉，熟悉 JavaScript", [
    { id: "sql", name: "SQL", aliases: ["sql"] },
    { id: "python", name: "Python", aliases: ["python"] },
    { id: "java", name: "Java", aliases: ["java"] },
    { id: "javascript", name: "JavaScript", aliases: ["javascript"] },
  ]);

  assert.deepEqual(result.skills, ["sql", "python", "java", "javascript"]);
  assert.deepEqual(result.skillSources[0].negatedAliases, ["SQL"]);
  assert.deepEqual(result.skillSources[1].uncertainAliases, ["Python"]);
  assert.deepEqual(result.skillSources[2].negatedAliases, ["Java"]);
  assert.deepEqual(result.skillSources[3].negatedAliases, []);
  assert.deepEqual(result.skillSources[3].uncertainAliases, []);
});
