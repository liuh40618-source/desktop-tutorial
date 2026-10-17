import assert from "node:assert/strict";
import test from "node:test";
import { FRESHNESS_LABEL, formatVerifiedAt, getFreshness } from "../lib/freshness.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-20T00:00:00.000Z");
/** @param {number} daysAgo */
const ago = (daysAgo) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

test("getFreshness 覆盖 89/90 边界（fresh → referenceable）", () => {
  assert.equal(getFreshness(ago(89), NOW), "fresh");
  assert.equal(getFreshness(ago(90), NOW), "referenceable");
});

test("getFreshness 覆盖 180 边界（referenceable → needs_review）", () => {
  assert.equal(getFreshness(ago(179), NOW), "referenceable");
  assert.equal(getFreshness(ago(180), NOW), "needs_review");
});

test("getFreshness 覆盖 365 边界（needs_review → outdated）", () => {
  assert.equal(getFreshness(ago(364), NOW), "needs_review");
  assert.equal(getFreshness(ago(365), NOW), "outdated");
});

test("getFreshness 对 null / 非法输入保守判为 outdated，且不抛异常", () => {
  assert.equal(getFreshness(null, NOW), "outdated");
  assert.equal(getFreshness(undefined, NOW), "outdated");
  assert.equal(getFreshness("", NOW), "outdated");
  assert.equal(getFreshness("not-a-date", NOW), "outdated");
  assert.equal(getFreshness("2026-13-45", NOW), "outdated");
});

test("FRESHNESS_LABEL 覆盖全部四档", () => {
  assert.deepEqual(Object.keys(FRESHNESS_LABEL).sort(), [
    "fresh",
    "needs_review",
    "outdated",
    "referenceable",
  ]);
});

test("formatVerifiedAt 按陈旧度切换展示格式", () => {
  assert.equal(formatVerifiedAt(ago(0), NOW), "今天复核");
  assert.equal(formatVerifiedAt(ago(10), NOW), "10 天前复核");
  assert.equal(formatVerifiedAt(ago(29), NOW), "29 天前复核");
  assert.equal(formatVerifiedAt(ago(200), NOW), "6 个月前复核");
  assert.match(formatVerifiedAt(ago(400), NOW), /^\d{4}-\d{2}-\d{2} 复核$/);
});

test("formatVerifiedAt 对 null / 非法输入返回「复核时间未知」，且不抛异常", () => {
  assert.equal(formatVerifiedAt(null, NOW), "复核时间未知");
  assert.equal(formatVerifiedAt(undefined, NOW), "复核时间未知");
  assert.equal(formatVerifiedAt("bad", NOW), "复核时间未知");
});
