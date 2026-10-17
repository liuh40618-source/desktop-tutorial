import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDeliverable, requiredElementsFor } from "../lib/evaluate-deliverable.ts";

const types = {
  report: {
    label: "分析报告",
    requiredElements: ["原始数据来源", "处理前后数量对比", "问题分类与处理理由", "可复现步骤或脚本"],
  },
  caseStudy: {
    label: "案例复盘",
    requiredElements: ["背景与问题", "个人贡献", "方法与过程", "结果与量化", "反思"],
  },
  other: {
    label: "其他作品",
    requiredElements: ["任务说明", "个人贡献", "可复现步骤", "结果记录"],
  },
};

const allYes = (elements, extra = {}) =>
  Object.fromEntries(elements.map((e) => [e, "yes"]).concat(Object.entries(extra)));

test("requiredElementsFor 缺 type 时回退 other，且不抛异常", () => {
  assert.deepEqual(requiredElementsFor("report", types), types.report.requiredElements);
  assert.deepEqual(requiredElementsFor("nope", types), types.other.requiredElements);
  assert.deepEqual(requiredElementsFor("nope", {}), []);
  assert.deepEqual(requiredElementsFor(null, null), []);
});

test("等级 4：要素齐全 + 有可核对材料 + 可展示", () => {
  const elements = types.report.requiredElements;
  const result = evaluateDeliverable(
    { type: "report", artifactLocation: "https://example.com/report.pdf", userElementChecks: allYes(elements, { presentable: "yes" }) },
    types
  );
  assert.equal(result.suggestedLevel, 4);
  assert.deepEqual(result.missingElements, []);
});

test("等级 3：ratio >= 0.6", () => {
  const elements = types.caseStudy.requiredElements; // 5 项
  const checks = { [elements[0]]: "yes", [elements[1]]: "yes", [elements[2]]: "yes" };
  const result = evaluateDeliverable({ type: "caseStudy", userElementChecks: checks }, types);
  assert.equal(result.suggestedLevel, 3);
  assert.equal(result.confirmedElements.length, 3);
  assert.equal(result.missingElements.length, 2);
});

test("等级 2：ratio < 0.6 但有可核对材料", () => {
  const result = evaluateDeliverable({ type: "report", artifactLocation: "repo/", userElementChecks: {} }, types);
  assert.equal(result.suggestedLevel, 2);
});

test("等级 1：ratio < 0.6 且无材料", () => {
  const result = evaluateDeliverable({ type: "report", userElementChecks: {} }, types);
  assert.equal(result.suggestedLevel, 1);
});

test("等级 5 绝不由本函数给出（避免把个人作品拔高成岗位经验）", () => {
  const elements = types.report.requiredElements;
  const result = evaluateDeliverable(
    { type: "report", artifactLocation: "x", userElementChecks: allYes(elements, { presentable: "yes" }) },
    types
  );
  assert.ok(result.suggestedLevel <= 4);
});

test("规则层检测命中要素并回显原文片段（「我看了你的什么」）", () => {
  const result = evaluateDeliverable(
    { type: "report", artifactNote: "处理了 120 行异常数据，来源 data.csv", userElementChecks: {} },
    types
  );
  assert.ok(result.confirmedElements.includes("原始数据来源"));
  assert.ok(result.confirmedElements.includes("处理前后数量对比"));
  assert.ok(result.ruleHits.some((h) => h.includes("来源")));
  assert.ok(result.ruleHits.some((h) => h.includes("120")));
});

test("缺 type / 缺 types 不抛异常", () => {
  assert.doesNotThrow(() => evaluateDeliverable({ userElementChecks: {} }, types));
  assert.doesNotThrow(() => evaluateDeliverable({ type: "report", userElementChecks: {} }, {}));
  const result = evaluateDeliverable({ type: "unknown", userElementChecks: {} }, types);
  assert.ok(result.suggestedLevel >= 1 && result.suggestedLevel <= 4);
});
