#!/usr/bin/env node
/**
 * apply-r1-freshness.mjs —— R1-1 数据落地（时效体系「真实抽样」）
 *
 * 用法（项目根目录）：node scripts/data/apply-r1-freshness.mjs
 *
 * 做三件事（只改 data/jobs.json、data/skills.json，不改任何代码/界面）：
 *  ① 3 个已做真实 JD 抽样的岗位：按**真实抽样份数**填 sample_size、verified_at=today、
 *     confidence 由 lib/confidence.mjs 推导；并按 JD 证据调整 core/plus（依据见 jd-verification-notes.md）。
 *  ② 其余岗位：sample_size=0、confidence='low'（没有 JD 样本就是 <5 就是 low），并在 _meta.note 写明。
 *  ③ tracks[].sampleSize 语义统一为「抽样核对的 JD 份数」：已抽样方向填真实份数，其余 0/low。
 *
 * 幂等：重复运行结果一致（core/plus 增删均有去重守卫）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confidenceForSampleSize } from "../../lib/confidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TODAY = "2026-09-26"; // 本轮人工抽样采集日
const NEW_VERSION = "3.4"; // 数据变更需升档，触发 lib/db.ts#seedIfEmpty 重种子化

// 抽样结果：份数 = scripts/data/jd-observations.json 中该岗位的观察条数（抽了几份就是几份）
const SAMPLED = {
  "data-analyst": {
    sampleSize: 6,
    coreAdd: [["python", 2]], // JD 证据：6 份中 5 份把 Python/R 列为任职要求 → 从加分项升为重要
    plusRemove: ["python"],
  },
  "fe-web": {
    sampleSize: 6,
    plusAdd: ["api-design"], // JD 证据：2 份任职要求明确「熟悉 HTTP 协议 / RESTful API 交互」
  },
  "pm-b": {
    sampleSize: 6,
    coreAdd: [["structured-expression", 2]], // JD 证据：6/6 份把「沟通表达 / 跨团队协作」列为任职要求
    plusRemove: ["structured-expression", "api-design"], // api-design：6 份抽样 JD 均未提及 → 移出加分项
  },
};
// tracks[].sampleSize 语义统一为「抽样核对的 JD 份数」（= 该方向内已抽样岗位的观察条数）
const TRACK_SAMPLED = { data: 6, frontend: 6, product: 6 };

const jobsPath = path.join(ROOT, "data", "jobs.json");
const skillsPath = path.join(ROOT, "data", "skills.json");
const jobsJson = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
const skillsJson = JSON.parse(fs.readFileSync(skillsPath, "utf8"));

const before = {};
for (const j of jobsJson.jobs) before[j.confidence] = (before[j.confidence] || 0) + 1;

for (const job of jobsJson.jobs) {
  const s = SAMPLED[job.id];
  if (s) {
    job.sample_size = s.sampleSize;
    job.verified_at = TODAY;
    job.confidence = confidenceForSampleSize(s.sampleSize);
    for (const [sid, w] of s.coreAdd || []) {
      if (!job.core.some((c) => c.s === sid)) job.core.push({ s: sid, w });
    }
    if (s.plusRemove) job.plus = job.plus.filter((p) => !s.plusRemove.includes(p));
    for (const sid of s.plusAdd || []) if (!job.plus.includes(sid)) job.plus.push(sid);
  } else {
    job.sample_size = 0;
    job.confidence = confidenceForSampleSize(0);
  }
}

for (const t of jobsJson.tracks) {
  t.sampleSize = TRACK_SAMPLED[t.id] ?? 0;
  t.confidence = confidenceForSampleSize(t.sampleSize);
  if (TRACK_SAMPLED[t.id]) t.verifiedAt = TODAY;
}

const NOTE_ADDENDUM =
  `\nv${NEW_VERSION}：时效体系落真实抽样——已对 3 个岗位（data-analyst / fe-web / pm-b）基于公开渠道检索的真实 JD 抽样核对，并按真实抽样份数更新 sample_size 与 confidence（依据见 scripts/data/jd-observations.json 与 scripts/data/jd-verification-notes.md）。` +
  `除这 3 个已抽样核对的岗位外，其余岗位为人工模板整理，尚未基于真实 JD 抽样，sample_size 记为 0、confidence 为 low。`;
jobsJson._meta.version = NEW_VERSION;
if (!jobsJson._meta.note.includes("尚未基于真实 JD 抽样")) {
  jobsJson._meta.note = jobsJson._meta.note.replace(/\n+$/, "") + NOTE_ADDENDUM;
}
skillsJson._meta.version = NEW_VERSION;

function writeJson(targetPath, obj) {
  const text = JSON.stringify(obj, null, 2) + "\n";
  try {
    fs.writeFileSync(targetPath, text);
    return targetPath;
  } catch (err) {
    // 某些受限环境（沙箱 / 文件被占用）不允许进程覆盖已存在文件，退回写 *.next 由人工替换
    if (err && (err.code === "EPERM" || err.code === "EACCES")) {
      const next = `${targetPath}.next`;
      fs.writeFileSync(next, text);
      console.warn(`⚠️ 无法直接覆盖 ${targetPath}（${err.code}），已写出 ${next}，请用 cp 覆盖后再删除`);
      return next;
    }
    throw err;
  }
}

writeJson(jobsPath, jobsJson);
writeJson(skillsPath, skillsJson);

const after = {};
for (const j of jobsJson.jobs) after[j.confidence] = (after[j.confidence] || 0) + 1;
console.log("jobs.confidence 改前:", JSON.stringify(before), "→ 改后:", JSON.stringify(after));
console.log(
  "tracks.sampleSize/confidence:",
  jobsJson.tracks.map((t) => `${t.id}=${t.sampleSize}/${t.confidence}`).join("  ")
);
console.log(`_meta.version: jobs=${jobsJson._meta.version} skills=${skillsJson._meta.version}`);
