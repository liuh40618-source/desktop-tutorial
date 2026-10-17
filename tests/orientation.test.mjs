import assert from "node:assert/strict";
import test from "node:test";
import {
  TRACK_EXCLUDE_RATIO,
  computeOrientation,
  estimateCandidateLevel,
  filterKnownSkillIds,
} from "../lib/orientation.ts";

const kb = {
  tracks: [
    { id: "frontend", name: "前端" },
    { id: "product", name: "产品" },
    { id: "qa", name: "测试" },
  ],
  contentOptions: [
    { id: "code-debug", tag: "code-debug", label: "花大段时间卡在一个 bug 上，反复试错", reason: "你不想写代码调试" },
    { id: "doc-alignment", tag: "doc-alignment", label: "写几万字的文档，还要反复对齐口径", reason: "你不想做文档撰写与跨方对齐类工作" },
    { id: "detail-audit", tag: "detail-audit", label: "逐条核对细节，出了错要担责", reason: "你不想做质量核查类工作" },
  ],
  contextOptions: [
    { id: "overtime-weekend", tag: "overtime-weekend", label: "长期加班、周末待命", reason: "你接受不了长期加班与周末待命" },
  ],
  jobs: [
    { id: "fe-1", title: "前端 1", track: "frontend", core: [{ s: "js", w: 3 }], workTags: [{ tag: "code-debug", tier: "core", note: "n", reviewStatus: "confirmed" }] },
    { id: "fe-2", title: "前端 2", track: "frontend", core: [{ s: "ts", w: 3 }], workTags: [{ tag: "code-debug", tier: "core", note: "n", reviewStatus: "confirmed" }] },
    { id: "pm-1", title: "产品 1", track: "product", core: [{ s: "prd", w: 3 }], workTags: [{ tag: "doc-alignment", tier: "core", note: "n", reviewStatus: "confirmed" }] },
    { id: "qa-1", title: "测试 1", track: "qa", core: [{ s: "qa", w: 3 }], workTags: [{ tag: "detail-audit", tier: "core", note: "n", reviewStatus: "confirmed" }] },
  ],
  starterSkills: [],
};

const emptyInput = { contentOptionIds: [], contextOptionIds: [], knownSkillIds: [] };

test("estimateCandidateLevel 覆盖四档边界（禁止百分比）", () => {
  assert.equal(estimateCandidateLevel(4, 3), "高");
  assert.equal(estimateCandidateLevel(3, 3), "中高");
  assert.equal(estimateCandidateLevel(2, 2), "中高");
  assert.equal(estimateCandidateLevel(1, 1), "中");
  assert.equal(estimateCandidateLevel(1, 0), "低");
  assert.equal(estimateCandidateLevel(0, 0), "低");
});

test("内容 tag 的 core 行触发岗位级与方向级排除", () => {
  const result = computeOrientation({ ...emptyInput, contentOptionIds: ["code-debug"] }, kb, 1000);
  assert.deepEqual(result.excludedJobIds, ["fe-1", "fe-2"]);
  assert.deepEqual(result.excludedTrackIds, ["frontend"]);
  assert.deepEqual(result.partialTrackIds, []);
  assert.equal(result.excludedJobs.length, 2);
  assert.deepEqual(result.excludedJobs[0].tagIds, ["code-debug"]);
  assert.equal(result.excludedJobs[0].title, "前端 1");
  assert.equal(result.completedAt, 1000);
  assert.equal(result.skipped, false);
  assert.equal(TRACK_EXCLUDE_RATIO, 0.6);
});

test("条件选项恒定不参与排除，只原样回传", () => {
  const result = computeOrientation({ ...emptyInput, contextOptionIds: ["overtime-weekend"] }, kb, 1);
  assert.deepEqual(result.excludedJobIds, []);
  assert.deepEqual(result.excludedTrackIds, []);
  assert.deepEqual(result.partialTrackIds, []);
  assert.deepEqual(result.contextExcluded, ["overtime-weekend"]);
  assert.equal(result.contextExclusionApplied, false);
});

test("候选方向只用等级，且排除的方向不进入候选", () => {
  const result = computeOrientation({ ...emptyInput, contentOptionIds: ["code-debug"], knownSkillIds: ["prd"] }, kb, 1);
  const ids = result.candidates.map((c) => c.trackId);
  assert.ok(!ids.includes("frontend"));
  assert.ok(ids.includes("product"));
  for (const candidate of result.candidates) {
    assert.ok(["高", "中高", "中", "低"].includes(candidate.level));
    assert.ok(candidate.reasons.length > 0);
    assert.ok(candidate.pending.length > 0);
    assert.ok(candidate.sampleJobIds.every((id) => !result.excludedJobIds.includes(id)));
  }
});

test("岗位级排除永远有结果（每岗 ≥1 条 core 内容 tag）", () => {
  const result = computeOrientation({ ...emptyInput, contentOptionIds: ["doc-alignment"] }, kb, 1);
  assert.deepEqual(result.excludedJobIds, ["pm-1"]);
});

test("缺 KB 字段不抛异常，返回安全默认", () => {
  const result = computeOrientation(emptyInput, { jobs: [], tracks: [], contentOptions: [], contextOptions: [], starterSkills: [] }, 5);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.excludedJobIds, []);
  assert.deepEqual(result.excludedReasons, []);
  assert.equal(result.contextExclusionApplied, false);
  assert.doesNotThrow(() => computeOrientation({}, {}));
});

test("filterKnownSkillIds 过滤库外 id 并去重", () => {
  const known = new Set(["sql", "python"]);
  assert.deepEqual(filterKnownSkillIds(["sql", "sql", "ghost", "", null, "python"], known), ["sql", "python"]);
  assert.deepEqual(filterKnownSkillIds(null, known), []);
});
