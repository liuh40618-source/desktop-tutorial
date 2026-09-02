#!/usr/bin/env node
/**
 * validate-data.mjs —— 数据文件一致性校验器（只读，零第三方依赖）。
 *
 * 用法（在 career-navigator 根目录运行）：
 *   node scripts/validate-data.mjs
 *
 * 职责：对 data/jobs.json + data/skills.json 做可重复执行的静态回归校验，
 *   供手工维护后自查，避免带病数据进入引擎（DB 种子化 / 覆盖率计算）。
 *   任一检查 ✗ → 打印明细并 process.exit(1)；全部 ✓ → exit(0)。
 *
 * 与 scripts/expand-data.mjs 的分工：expand-data 负责“扩充/合并/写库”，
 *   是写路径；本脚本只做“校验”，是只读守门。改数据后先跑本脚本再提交。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// 载入数据
// ---------------------------------------------------------------------------
const jobsJson = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "jobs.json"), "utf8"));
const skillsJson = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "skills.json"), "utf8"));

const tracks = Array.isArray(jobsJson.tracks) ? jobsJson.tracks : [];
const jobs = Array.isArray(jobsJson.jobs) ? jobsJson.jobs : [];
const skills = Array.isArray(skillsJson.skills) ? skillsJson.skills : [];

// ---------------------------------------------------------------------------
// 平台白名单：从 lib/links.ts 的 PLATFORM_TEMPLATES 提取 resolveUrl 支持键
// （只读解析 TS 源码，不 import；lib/* 不在本次可改范围）
// ---------------------------------------------------------------------------
const linksSrc = fs.readFileSync(path.join(ROOT, "lib", "links.ts"), "utf8");
const tplStart = linksSrc.indexOf("PLATFORM_TEMPLATES");
const tplBody =
  tplStart === -1 ? "" : linksSrc.slice(tplStart, linksSrc.indexOf("};", tplStart));
const PLATFORM_WHITELIST = new Set();
const PLATFORM_RE = /^\s*['"]?([^'"\n:]+?)['"]?\s*:\s*\(q\)\s*=>/gm;
{
  let m;
  while ((m = PLATFORM_RE.exec(tplBody))) PLATFORM_WHITELIST.add(m[1].trim());
}

const ID_RE = /^[a-z0-9-]+$/;
const WEIGHTS = new Set([1, 2, 3]);

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
const lines = [];
function pass(name, detail = "") {
  lines.push(`✓ ${name}${detail ? `  (${detail})` : ""}`);
}
function fail(name, detail) {
  lines.push(`✗ ${name}${detail ? `  (${detail})` : ""}`);
}
function check(name, ok, detail = "") {
  (ok ? pass : fail)(name, detail);
  return ok;
}
function dupIds(list) {
  const seen = new Set();
  const dups = [];
  for (const id of list) {
    if (seen.has(id)) dups.push(id);
    seen.add(id);
  }
  return [...new Set(dups)];
}
function badIds(list) {
  return list.filter((id) => !ID_RE.test(id));
}

// ---------------------------------------------------------------------------
// 1. id 唯一性 + 命名
// ---------------------------------------------------------------------------
const trackIds = tracks.map((t) => t && t.id);
const jobIds = jobs.map((x) => x && x.id);
const skillIds = skills.map((x) => x && x.id);

const dupTracks = dupIds(trackIds);
const dupJobs = dupIds(jobIds);
const dupSkills = dupIds(skillIds);
check("tracks.id 唯一", dupTracks.length === 0, dupTracks.join(",") || `${trackIds.length} 个`);
check("jobs.id 唯一", dupJobs.length === 0, dupJobs.join(",") || `${jobIds.length} 个`);
check("skills.id 唯一", dupSkills.length === 0, dupSkills.join(",") || `${skillIds.length} 个`);

const badTrackIds = badIds(trackIds);
const badJobIds = badIds(jobIds);
const badSkillIds = badIds(skillIds);
check("id 命名(小写/数字/连字符): tracks", badTrackIds.length === 0, badTrackIds.join(",") || "合规");
check("id 命名(小写/数字/连字符): jobs", badJobIds.length === 0, badJobIds.join(",") || "合规");
check("id 命名(小写/数字/连字符): skills", badSkillIds.length === 0, badSkillIds.join(",") || "合规");

const trackIdSet = new Set(trackIds);
const skillIdSet = new Set(skillIds);

// ---------------------------------------------------------------------------
// 2. job.track 必须存在
// ---------------------------------------------------------------------------
const badTrackRefs = jobs.filter((x) => !trackIdSet.has(x.track)).map((x) => `${x.id}->${x.track}`);
check("job.track 均在 tracks 中", badTrackRefs.length === 0, badTrackRefs.join(",") || `${jobs.length} 个岗位`);

// ---------------------------------------------------------------------------
// 3. core/plus 技能引用 + 权重
// ---------------------------------------------------------------------------
const missingRefs = [];
const badWeights = [];
let coreRefCount = 0;
let plusRefCount = 0;
for (const job of jobs) {
  for (const c of job.core || []) {
    coreRefCount += 1;
    if (!skillIdSet.has(c.s)) missingRefs.push(`${job.id}.core.${String(c.s)}`);
    if (!WEIGHTS.has(c.w)) badWeights.push(`${job.id}.${String(c.s)}->w=${c.w}`);
  }
  for (const p of job.plus || []) {
    plusRefCount += 1;
    if (!skillIdSet.has(p)) missingRefs.push(`${job.id}.plus.${String(p)}`);
  }
}
check("core[].s / plus[] 引用技能均存在", missingRefs.length === 0, missingRefs.join(",") || `${coreRefCount + plusRefCount} 处引用`);
check("core[].w 权重 ∈ {1,2,3}", badWeights.length === 0, badWeights.join(",") || "合规");

// ---------------------------------------------------------------------------
// 4. 薪资量级描述非空
// ---------------------------------------------------------------------------
const badSalary = [];
for (const job of jobs) {
  for (const f of ["intern", "junior"]) {
    const v = job.salary && job.salary[f];
    if (!v || typeof v !== "string" || !v.trim()) badSalary.push(`${job.id}.salary.${f}`);
  }
}
check("salary.intern/junior 非空", badSalary.length === 0, badSalary.join(",") || `${jobs.length * 2} 项`);

// ---------------------------------------------------------------------------
// 5. skill: estHours / aliases / resources.platform
// ---------------------------------------------------------------------------
const badEstHours = [];
const badAliases = [];
const badPlatforms = [];
let resourceCount = 0;
for (const sk of skills) {
  const eh = sk.estHours;
  if (!Number.isInteger(eh) || eh <= 0) badEstHours.push(`${sk.id}=${JSON.stringify(eh)}`);
  const al = sk.aliases;
  if (!Array.isArray(al) || al.length === 0) {
    badAliases.push(`${sk.id}:空数组`);
  } else {
    for (const a of al) {
      if (typeof a !== "string" || !a.trim()) badAliases.push(`${sk.id}:空串`);
    }
  }
  for (const r of sk.resources || []) {
    resourceCount += 1;
    if (!PLATFORM_WHITELIST.has(r.platform)) badPlatforms.push(`${sk.id}->${String(r.platform)}`);
  }
}
check("skill.estHours 为正整数", badEstHours.length === 0, badEstHours.join(",") || `${skills.length} 项`);
check("skill.aliases 非空且无空串", badAliases.length === 0, badAliases.join(",") || `${skills.length} 项`);
check("resources[].platform 在白名单内", badPlatforms.length === 0, badPlatforms.join(",") || `${resourceCount} 条资源`);

// ---------------------------------------------------------------------------
// 6. _meta.version 一致
// ---------------------------------------------------------------------------
const jobsVer = jobsJson._meta && jobsJson._meta.version;
const skillsVer = skillsJson._meta && skillsJson._meta.version;
check("_meta.version 两文件一致", jobsVer === skillsVer && !!jobsVer, `jobs=${jobsVer} / skills=${skillsVer}`);

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
console.log("--- 数据一致性校验 ---");
console.log(`jobs.json : ${jobs.length} 岗位 / ${tracks.length} 方向`);
console.log(`skills.json: ${skills.length} 技能`);
console.log(`核心引用 ${coreRefCount} 处，加分引用 ${plusRefCount} 处，资源 ${resourceCount} 条`);
console.log(`平台白名单(${PLATFORM_WHITELIST.size}): ${[...PLATFORM_WHITELIST].join(" / ")}`);
console.log("");
for (const l of lines) console.log(l);

const failed = lines.some((l) => l.startsWith("✗"));
console.log("");
if (failed) {
  console.log(`RESULT: FAIL (${lines.filter((l) => l.startsWith("✗")).length} 项未通过)`);
  process.exit(1);
} else {
  console.log(`RESULT: PASS —— 岗位 ${jobs.length} / 方向 ${tracks.length} / 技能 ${skills.length} / 核心引用 ${coreRefCount}`);
  process.exit(0);
}
