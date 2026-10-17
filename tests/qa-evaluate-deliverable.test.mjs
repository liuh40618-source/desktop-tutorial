import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { evaluateDeliverable, requiredElementsFor } from "../lib/evaluate-deliverable.ts";

/**
 * QA 对抗性测试（C-7）：evaluate-deliverable 等级映射与安全边界
 *
 * 硬要求：
 *  - 四档映射正确；
 *  - **等级 5 绝不由本函数给出**（不得把个人作品拔高成岗位经验）；
 *  - 缺 type → 用 other；
 *  - requiredElements 全缺失 / 空 artifactNote / userElementChecks 为空对象 → 不抛异常。
 */
const TYPES = JSON.parse(readFileSync(new URL("../data/deliverable-types.json", import.meta.url), "utf8")).types;

test("C7-1 四档映射逐档验证", () => {
  // 等级 4：全要素命中 + artifactLocation 非空 + presentable==='yes'
  const all = Object.fromEntries(TYPES.report.requiredElements.map((e) => [e, "yes"]));
  const l4 = evaluateDeliverable(
    { type: "report", artifactLocation: "https://example.com/report", userElementChecks: { ...all, presentable: "yes" } },
    TYPES
  );
  assert.equal(l4.suggestedLevel, 4);
  assert.deepEqual(l4.missingElements, []);

  // 等级 3：ratio>=0.6 但未满足等级 4 条件
  const partial = Object.fromEntries(TYPES.report.requiredElements.slice(0, 3).map((e) => [e, "yes"]));
  assert.equal(evaluateDeliverable({ type: "report", userElementChecks: partial }, TYPES).suggestedLevel, 3);

  // 等级 2：ratio<0.6 但 artifactLocation 非空
  assert.equal(evaluateDeliverable({ type: "report", artifactLocation: "本地文件", userElementChecks: {} }, TYPES).suggestedLevel, 2);

  // 等级 1：什么都没有
  assert.equal(evaluateDeliverable({ type: "report", userElementChecks: {} }, TYPES).suggestedLevel, 1);
});

test("C7-2 【硬要求】等级 5 绝不由本函数给出（构造极端输入）", () => {
  const all = Object.fromEntries(TYPES.report.requiredElements.map((e) => [e, "yes"]));
  const cases = [
    { type: "report", artifactTitle: "x", artifactLocation: "y", artifactNote: "全部完成", userElementChecks: { ...all, presentable: "yes" } },
    { type: "case-study", artifactLocation: "z", userElementChecks: { ...Object.fromEntries(TYPES["case-study"].requiredElements.map((e) => [e, "yes"])), presentable: "yes" } },
  ];
  for (const c of cases) {
    const r = evaluateDeliverable(c, TYPES);
    assert.ok(r.suggestedLevel <= 4, `等级必须 ≤4，实际 ${r.suggestedLevel}`);
    assert.notEqual(r.suggestedLevel, 5);
  }
});

test("C7-3 缺 type / type 为空串 → 回落到 other 的 requiredElements", () => {
  assert.deepEqual(requiredElementsFor(undefined, TYPES), TYPES.other.requiredElements);
  assert.deepEqual(requiredElementsFor("", TYPES), TYPES.other.requiredElements);
  assert.deepEqual(requiredElementsFor("不存在的类型", TYPES), TYPES.other.requiredElements);
  assert.equal(evaluateDeliverable({ userElementChecks: {} }, TYPES).suggestedLevel, 1);
});

test("C7-4 requiredElements 全缺失 / 空 artifactNote / 空 userElementChecks 不抛异常", () => {
  assert.doesNotThrow(() => evaluateDeliverable({ type: "report", artifactNote: "", userElementChecks: {} }, TYPES));
  assert.doesNotThrow(() => evaluateDeliverable({ type: "report", artifactNote: "", userElementChecks: {} }, {}));
  assert.doesNotThrow(() => evaluateDeliverable({}, {}));
  assert.doesNotThrow(() => evaluateDeliverable(null, null));
  assert.doesNotThrow(() => evaluateDeliverable(undefined, undefined));
  assert.doesNotThrow(() => requiredElementsFor("report", null));
});

test("C7-5 requiredElements 为空数组时 ratio=0，不会误判为等级 4", () => {
  const r = evaluateDeliverable({ type: "x", artifactLocation: "y", userElementChecks: { presentable: "yes" } }, { x: { label: "X", requiredElements: [] } });
  assert.equal(r.suggestedLevel, 2); // ratio 无法达到 1，仅凭 location 到 2
});

test("C7-6 ruleHits 只报告命中的必含要素，且可追溯原文片段", () => {
  const r = evaluateDeliverable(
    { type: "report", artifactNote: "数据来源为业务库导出 csv；处理前后 1200 行对比", userElementChecks: {} },
    TYPES
  );
  assert.ok(r.ruleHits.length > 0);
  assert.ok(r.ruleHits.some((h) => h.includes("原始数据来源")));
  assert.ok(r.ruleHits.every((h) => typeof h === "string" && h.length > 0));
});

test("C7-7 confirmedElements + missingElements 应等于 requiredElements 全集", () => {
  const r = evaluateDeliverable({ type: "dataset", userElementChecks: { 字段说明: "yes" } }, TYPES);
  assert.equal(r.confirmedElements.length + r.missingElements.length, TYPES.dataset.requiredElements.length);
  assert.ok(r.confirmedElements.includes("字段说明"));
});
