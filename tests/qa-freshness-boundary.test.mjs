import assert from "node:assert/strict";
import test from "node:test";
import { formatVerifiedAt, getFreshness } from "../lib/freshness.ts";

/**
 * QA 对抗性测试（C-5）：freshness 边界与非法输入
 * 目标：任何输入都不得抛异常；档位与文档一致；缺失/非法一律保守。
 */
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-20T12:00:00.000Z");
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();

test("C5-1 四个档位边界（89/90/179/180/364/365）逐点验证", () => {
  assert.equal(getFreshness(ago(89), NOW), "fresh");
  assert.equal(getFreshness(ago(90), NOW), "referenceable");
  assert.equal(getFreshness(ago(179), NOW), "referenceable");
  assert.equal(getFreshness(ago(180), NOW), "needs_review");
  assert.equal(getFreshness(ago(364), NOW), "needs_review");
  assert.equal(getFreshness(ago(365), NOW), "outdated");
});

test("C5-2 null / undefined / 空串 / 非法字符串一律 outdated，且不抛异常", () => {
  for (const v of [null, undefined, "", "   ", "abc", "not-a-date", "2026-13-45"]) {
    assert.doesNotThrow(() => getFreshness(v, NOW), `getFreshness(${JSON.stringify(v)}) 不应抛异常`);
    assert.equal(getFreshness(v, NOW), "outdated", `getFreshness(${JSON.stringify(v)}) 应保守为 outdated`);
  }
  // 记录：Date.parse 对「日历非法但格式合法」的日期会自行进位（2026-02-30 → 2026-03-02），
  // 故不会被判为非法。这是 JS 引擎行为，非本模块缺陷，仅作边界记录。
  assert.doesNotThrow(() => getFreshness("2026-02-30", NOW));
});

test("C5-3 非字符串类型（数字/对象/数组/布尔）不抛异常", () => {
  for (const v of [0, 123, {}, [], true, false, NaN]) {
    assert.doesNotThrow(() => getFreshness(v, NOW), `getFreshness(${JSON.stringify(v)}) 不应抛异常`);
  }
});

test("C5-4 now 非法时退化而不抛异常", () => {
  assert.doesNotThrow(() => getFreshness(ago(10), new Date("bad")));
  assert.doesNotThrow(() => getFreshness(ago(10), null));
  assert.doesNotThrow(() => getFreshness(ago(10), undefined));
});

test("C5-5 formatVerifiedAt(null/undefined/非法) === 「复核时间未知」", () => {
  assert.equal(formatVerifiedAt(null, NOW), "复核时间未知");
  assert.equal(formatVerifiedAt(undefined, NOW), "复核时间未知");
  assert.equal(formatVerifiedAt("abc", NOW), "复核时间未知");
  assert.equal(formatVerifiedAt("", NOW), "复核时间未知");
});

test("C5-6 未来日期：不抛异常（行为记录：会被判为 fresh/今天复核）", () => {
  const future = new Date(NOW.getTime() + 30 * DAY).toISOString();
  assert.doesNotThrow(() => getFreshness(future, NOW));
  // 记录当前行为：未来时间 → 负数天数 → 落在 <90d 档，保守性存疑但无异常
  assert.equal(getFreshness(future, NOW), "fresh");
  assert.equal(formatVerifiedAt(future, NOW), "今天复核");
});

test("C5-7 展示文案在 1/30/365 天处切换", () => {
  assert.equal(formatVerifiedAt(ago(0), NOW), "今天复核");
  assert.equal(formatVerifiedAt(ago(1), NOW), "1 天前复核");
  assert.equal(formatVerifiedAt(ago(29), NOW), "29 天前复核");
  assert.equal(formatVerifiedAt(ago(30), NOW), "1 个月前复核");
  assert.equal(formatVerifiedAt(ago(364), NOW), "12 个月前复核");
  assert.match(formatVerifiedAt(ago(365), NOW), /^\d{4}-\d{2}-\d{2} 复核$/);
});
