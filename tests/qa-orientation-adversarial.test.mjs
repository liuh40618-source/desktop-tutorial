import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  TRACK_EXCLUDE_RATIO,
  computeOrientation,
  estimateCandidateLevel,
  filterKnownSkillIds,
} from "../lib/orientation.ts";

/**
 * QA 对抗性测试（C-8）：orientation 反例与崩溃输入
 * 目标：任何输入都不得抛异常；库外 skillId 必须被过滤；方向级聚合正确。
 */
const exclusions = JSON.parse(readFileSync(new URL("../data/exclusions.json", import.meta.url), "utf8"));
const jobsJson = JSON.parse(readFileSync(new URL("../data/jobs.json", import.meta.url), "utf8"));
const starter = JSON.parse(readFileSync(new URL("../data/starter-skills.json", import.meta.url), "utf8"));
const skillsJson = JSON.parse(readFileSync(new URL("../data/skills.json", import.meta.url), "utf8"));

const KB = {
  jobs: jobsJson.jobs.map((j) => ({ id: j.id, title: j.title, track: j.track, workTags: j.workTags, core: j.core })),
  tracks: jobsJson.tracks.map((t) => ({ id: t.id, name: t.name })),
  contentOptions: exclusions.contentOptions,
  contextOptions: exclusions.contextOptions,
  starterSkills: starter.items,
};
const KNOWN = new Set(skillsJson.skills.map((s) => s.id));

test("C8-1 正常路径：勾选 code-debug 能排除编程类方向且不抛异常", () => {
  const r = computeOrientation({ contentOptionIds: ["code-debug"], contextOptionIds: [], knownSkillIds: [] }, KB);
  assert.ok(r.excludedJobIds.length > 0);
  assert.ok(r.excludedTrackIds.length > 0);
  assert.ok(r.candidates.length <= 3);
});

test("C8-2 重复的 contentOptionIds / contextOptionIds 不重复计数，且不抛异常", () => {
  const a = computeOrientation({ contentOptionIds: ["code-debug"], contextOptionIds: [], knownSkillIds: [] }, KB);
  const b = computeOrientation({ contentOptionIds: ["code-debug", "code-debug", "code-debug"], contextOptionIds: ["frequent-travel", "frequent-travel"], knownSkillIds: [] }, KB);
  assert.deepEqual(b.excludedJobIds, a.excludedJobIds);
  assert.deepEqual(b.contentExcluded, ["code-debug"]);
  assert.deepEqual(b.contextExcluded, ["frequent-travel"]);
});

test("C8-3 不存在的 option id 被静默忽略（不抛异常、不影响结果）", () => {
  assert.doesNotThrow(() => computeOrientation({ contentOptionIds: ["no-such-option"], contextOptionIds: ["nope"], knownSkillIds: [] }, KB));
  const r = computeOrientation({ contentOptionIds: ["no-such-option"], contextOptionIds: [], knownSkillIds: [] }, KB);
  assert.deepEqual(r.excludedJobIds, []);
});

test("C8-4 空 KB / 缺字段 / null 输入不抛异常", () => {
  const empty = { jobs: [], tracks: [], contentOptions: [], contextOptions: [], starterSkills: [] };
  assert.doesNotThrow(() => computeOrientation({ contentOptionIds: [], contextOptionIds: [], knownSkillIds: [] }, empty));
  assert.doesNotThrow(() => computeOrientation({}, empty));
  assert.doesNotThrow(() => computeOrientation({}, {}));
  assert.doesNotThrow(() => computeOrientation(null, null));
  assert.doesNotThrow(() => computeOrientation(undefined, undefined));
  assert.doesNotThrow(() => computeOrientation({ contentOptionIds: null, contextOptionIds: 123, knownSkillIds: "x" }, KB));
  const r = computeOrientation({ contentOptionIds: ["code-debug"], contextOptionIds: [], knownSkillIds: [] }, empty);
  assert.deepEqual(r.excludedJobIds, []);
  assert.deepEqual(r.candidates, []);
});

test("C8-5 某方向 0 岗位：不抛异常且不进入候选/排除", () => {
  const kb = { ...KB, tracks: [...KB.tracks, { id: "ghost", name: "幽灵方向" }] };
  const r = computeOrientation({ contentOptionIds: ["code-debug"], contextOptionIds: [], knownSkillIds: [] }, kb);
  assert.ok(!r.candidates.some((c) => c.trackId === "ghost"));
  assert.ok(!r.excludedTrackIds.includes("ghost"));
  assert.ok(!r.excludedReasons.some((x) => x.trackId === "ghost"));
});

test("C8-6 条件选项恒定不参与排除（contextExclusionApplied=false）", () => {
  const r = computeOrientation({ contentOptionIds: [], contextOptionIds: exclusions.contextOptions.map((o) => o.id), knownSkillIds: [] }, KB);
  assert.equal(r.contextExclusionApplied, false);
  assert.deepEqual(r.excludedJobIds, []);
});

test("C8-7 filterKnownSkillIds 必须过滤库外 id / 空串 / 非字符串 / 重复项", () => {
  const out = filterKnownSkillIds(["sql", "sql", "", "not-in-library", null, undefined, 123, "python"], KNOWN);
  assert.deepEqual(out, ["sql", "python"]);
  assert.deepEqual(filterKnownSkillIds([], KNOWN), []);
  assert.deepEqual(filterKnownSkillIds(null, KNOWN), []);
  assert.deepEqual(filterKnownSkillIds(["sql"], null), []);
});

test("C8-8 estimateCandidateLevel 边界：≥7 高 / ≥4 中高 / ≥2 中 / 否则低", () => {
  assert.equal(estimateCandidateLevel(7, 0), "高");
  assert.equal(estimateCandidateLevel(4, 0), "中高");
  assert.equal(estimateCandidateLevel(2, 0), "中");
  assert.equal(estimateCandidateLevel(1, 0), "低");
  assert.equal(estimateCandidateLevel(0, 0), "低");
  // 非法输入不得抛异常
  assert.doesNotThrow(() => estimateCandidateLevel(NaN, NaN));
  assert.equal(estimateCandidateLevel(-5, -5), "低");
  assert.equal(estimateCandidateLevel(Infinity, 0), "低"); // 非有限 → 归零
});

test("C8-9 等级只用「高/中高/中/低」，禁止百分比字样", () => {
  const r = computeOrientation({ contentOptionIds: ["code-debug"], contextOptionIds: [], knownSkillIds: ["sql", "python"] }, KB);
  for (const c of r.candidates) {
    assert.ok(["高", "中高", "中", "低"].includes(c.level), `非法等级 ${c.level}`);
    for (const s of [...c.reasons, ...c.pending]) assert.ok(!/%/.test(s), `reasons/pending 不应出现百分比: ${s}`);
  }
});

test("C8-10 TRACK_EXCLUDE_RATIO 常量值 = 0.6", () => {
  assert.equal(TRACK_EXCLUDE_RATIO, 0.6);
});
