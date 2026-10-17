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
// 共享纯函数模块（架构 §7.2 主理人改进）：校验器必须验「应用真正会用的那份逻辑」，
// 禁止内联复制 confidence 推导与 actionTemplate 解析，否则偏差永远不会被发现。
import { confidenceForSampleSize } from "../../lib/confidence.mjs";
import { resolveActionTemplate } from "../../lib/action-template.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
// 7. 增量 v0.1：exclusions 选项定义 + workTags（P1-2 / P1-3）
// ---------------------------------------------------------------------------
const exclusions = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "exclusions.json"), "utf8"));
const contentOptions = Array.isArray(exclusions.contentOptions) ? exclusions.contentOptions : [];
const contextOptions = Array.isArray(exclusions.contextOptions) ? exclusions.contextOptions : [];
const contentTagSet = new Set(contentOptions.map((o) => o.tag));
const contextTagSet = new Set(contextOptions.map((o) => o.tag));

const badOptionDefs = [];
for (const [kind, opts] of [["contentOptions", contentOptions], ["contextOptions", contextOptions]]) {
  for (const o of opts) {
    if (!o || !o.id || !o.tag || !o.label || !o.reason) badOptionDefs.push(`${kind}.${(o && o.id) || "?"}`);
    else if (o.id !== o.tag) badOptionDefs.push(`${kind}.${o.id}:id≠tag`);
  }
}
check("exclusions 选项 id/tag/label/reason 完整且 id===tag", badOptionDefs.length === 0, badOptionDefs.join(",") || `${contentOptions.length} 内容 + ${contextOptions.length} 条件`);
check("exclusions 内容 tag 数量 ≥3（下线后可为 9）", contentOptions.length >= 3, `${contentOptions.length} 项`);
check("exclusions 条件 tag = 7 项（仅自我清单，不参与排除）", contextOptions.length === 7, `${contextOptions.length} 项`);

// workTags 只允许内容 tag；条件 tag 不得回流；note 必须引用真实 summary 片段
const badWorkTagRefs = [];
const badContextRefs = [];
const badNoteRefs = [];
const badNoteWhole = [];
const badAssumedNote = [];
const tagCoreRefCount = new Map();
const SUMMARY_CITE = /summary「([^」]*)」/g;
for (const job of jobs) {
  const wt = Array.isArray(job.workTags) ? job.workTags : [];
  if (wt.length === 0) badWorkTagRefs.push(`${job.id}:workTags 为空`);
  for (const t of wt) {
    if (contextTagSet.has(t.tag)) badContextRefs.push(`${job.id}->${t.tag}`);
    else if (!contentTagSet.has(t.tag)) badWorkTagRefs.push(`${job.id}->${String(t.tag)}`);
    if (t.tier !== "core" && t.tier !== "incidental") badWorkTagRefs.push(`${job.id}.${t.tag}:tier=${String(t.tier)}`);
    if (typeof t.note !== "string" || !t.note.trim()) badWorkTagRefs.push(`${job.id}.${t.tag}:note 空`);
    if (t.reviewStatus !== "confirmed" && t.reviewStatus !== "assumed") badWorkTagRefs.push(`${job.id}.${t.tag}:reviewStatus=${String(t.reviewStatus)}`);
    if (typeof t.note === "string") {
      SUMMARY_CITE.lastIndex = 0;
      const cites = [...t.note.matchAll(SUMMARY_CITE)].map((m) => m[1]);
      if (cites.length === 0) badNoteRefs.push(`${job.id}.${t.tag}:note 未引用 summary`);
      for (const c of cites) {
        if (!job.summary.includes(c)) badNoteRefs.push(`${job.id}.${t.tag}:引用「${c}」不在 summary`);
        else if (c.length >= job.summary.length) badNoteWhole.push(`${job.id}.${t.tag}:整段引用 summary`);
      }
      // assumed 行必须显式写明「人工初判 / 待校准」，避免把未支撑的判定伪装成已确认
      if (t.reviewStatus === "assumed" && !/人工初判|待校准/.test(t.note)) {
        badAssumedNote.push(`${job.id}.${t.tag}`);
      }
    }
    if (t.tier === "core") tagCoreRefCount.set(t.tag, (tagCoreRefCount.get(t.tag) || 0) + 1);
  }
}
check("workTags[].tag 均为内容 tag（条件 tag 不得回流）", badContextRefs.length === 0, badContextRefs.slice(0, 8).join(",") || "0 条条件 tag 行");
check("workTags[].tag 在白名单内且字段完整（note/tier/reviewStatus）", badWorkTagRefs.length === 0, badWorkTagRefs.slice(0, 8).join(",") || `${jobs.length} 个岗位`);
check("workTags[].note 引用的 summary 片段真实存在", badNoteRefs.length === 0, badNoteRefs.slice(0, 8).join(",") || "全部可追溯");
check("workTags[].note 禁止整段引用 summary（必须是真子串）", badNoteWhole.length === 0, badNoteWhole.slice(0, 8).join(",") || "全部为真子串");
check("reviewStatus='assumed' 的行 note 必须写明「人工初判 / 待校准」", badAssumedNote.length === 0, badAssumedNote.slice(0, 8).join(",") || "合规");

const noCoreContent = jobs
  .filter((job) => !(job.workTags || []).some((t) => t.tier === "core" && contentTagSet.has(t.tag)))
  .map((j) => j.id);
check("每岗 ≥1 条 tier='core' 的内容 tag", noCoreContent.length === 0, noCoreContent.join(",") || `${jobs.length} 个岗位`);

// 覆盖率只测 core：只有 core 触发排除，incidental 合计不参与覆盖率判断
const underCovered = [];
const overCovered = [];
for (const tag of contentTagSet) {
  const n = tagCoreRefCount.get(tag) || 0;
  if (n < 3) underCovered.push(`${tag}=${n}`);
  if (n / jobs.length > 0.6) overCovered.push(`${tag}=${((n / jobs.length) * 100).toFixed(1)}%`);
}
check("每个内容 tag ≥3 个岗位 core（下限）", underCovered.length === 0, underCovered.join(",") || `${contentTagSet.size} 个内容 tag`);
check("每个内容 tag 的 core 比例 ≤60%（上限）", overCovered.length === 0, overCovered.join(",") || `${contentTagSet.size} 个内容 tag`);

// ---------------------------------------------------------------------------
// 8. confidence 自洽 + 时效字段（P0-26 / P0-29，共享 lib/confidence.mjs）
// ---------------------------------------------------------------------------
const badConfidence = [];
for (const job of jobs) {
  const want = confidenceForSampleSize(job.sample_size);
  if (job.confidence !== want) badConfidence.push(`${job.id}:${job.confidence}≠${want}(${job.sample_size})`);
}
for (const sk of skills) {
  const want = confidenceForSampleSize(sk.sample_size);
  if (sk.confidence !== want) badConfidence.push(`skill.${sk.id}:${sk.confidence}≠${want}(${sk.sample_size})`);
}
for (const t of tracks) {
  const want = confidenceForSampleSize(t.sampleSize);
  if (t.confidence !== want) badConfidence.push(`track.${t.id}:${t.confidence}≠${want}(${t.sampleSize})`);
}
check("confidence 与 sample_size 自洽（jobs/skills/tracks 三处）", badConfidence.length === 0, badConfidence.slice(0, 8).join(",") || "合规");

const badFreshness = [];
for (const job of jobs) {
  for (const f of ["source_date", "updated_at", "verified_at"]) {
    if (typeof job[f] !== "string" || !job[f].trim()) badFreshness.push(`${job.id}.${f}`);
  }
  if (!Number.isInteger(job.sample_size)) badFreshness.push(`${job.id}.sample_size`);
}
for (const sk of skills) {
  for (const f of ["source_date", "updated_at", "verified_at"]) {
    if (typeof sk[f] !== "string" || !sk[f].trim()) badFreshness.push(`skill.${sk.id}.${f}`);
  }
  if (!Number.isInteger(sk.sample_size)) badFreshness.push(`skill.${sk.id}.sample_size`);
}
check("jobs/skills 的 5 个时效字段非空", badFreshness.length === 0, badFreshness.slice(0, 8).join(",") || `${jobs.length + skills.length} 条`);

// ---------------------------------------------------------------------------
// 9. 交付物可解析（P0-14，共享 lib/action-template.mjs 四级解析）
// ---------------------------------------------------------------------------
const actionTemplates = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "action-templates.json"), "utf8")).byCategory || {};
const deliverableTypes = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "deliverable-types.json"), "utf8")).types || {};
const unresolvable = [];
for (const sk of skills) {
  const r = resolveActionTemplate(sk, actionTemplates, deliverableTypes);
  if (!r.deliverable || !r.acceptance || !r.requiredElements.length) unresolvable.push(sk.id);
}
check("技能 100% 可解析 deliverable + acceptance + requiredElements", unresolvable.length === 0, unresolvable.join(",") || `${skills.length} 个技能`);

const skillCats = new Set(skills.map((s) => s.category));
const tplKeys = Object.keys(actionTemplates);
const tplMismatch = [...skillCats].filter((c) => !tplKeys.includes(c)).concat(tplKeys.filter((k) => !skillCats.has(k)));
check("action-templates.byCategory 键 == skills.category 原值", tplMismatch.length === 0, tplMismatch.join(",") || `${tplKeys.length} 个分类`);

// ---------------------------------------------------------------------------
// 10. starterSkills（P1-3）
// ---------------------------------------------------------------------------
const starter = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "starter-skills.json"), "utf8"));
const starterItems = Array.isArray(starter.items) ? starter.items : [];
const badStarter = [];
const dupStarterIds = dupIds(starterItems.map((i) => i && i.id));
if (dupStarterIds.length) badStarter.push(`重复 id:${dupStarterIds.join("|")}`);
for (const it of starterItems) {
  if (!it || !Array.isArray(it.skillIds) || it.skillIds.length === 0) {
    badStarter.push(`${(it && it.id) || "?"}:skillIds 空`);
    continue;
  }
  for (const sid of it.skillIds) if (!skillIdSet.has(sid)) badStarter.push(`${it.id}->${sid}`);
}
check("starterSkills item.id 唯一 / skillIds 非空且均存在", badStarter.length === 0, badStarter.join(",") || `${starterItems.length} 项`);

// ---------------------------------------------------------------------------
// 11. tracks 领域说明书（P1-3 / PRD 4.4）
// ---------------------------------------------------------------------------
const badBrief = [];
const RE_ENTRY = /按每周\s*\d+\s*小时估算，不是承诺/;
for (const t of tracks) {
  for (const f of ["oneLiner", "entryCycle", "dataNote", "verifiedAt"]) {
    if (typeof t[f] !== "string" || !t[f].trim()) badBrief.push(`${t.id}.${f}`);
  }
  if (!Array.isArray(t.subDirections) || t.subDirections.length === 0) badBrief.push(`${t.id}.subDirections`);
  if (!Array.isArray(t.hardThresholds)) badBrief.push(`${t.id}.hardThresholds`);
  if (!Array.isArray(t.glossary) || t.glossary.length < 5) {
    badBrief.push(`${t.id}.glossary<5`);
  } else {
    for (const g of t.glossary) {
      if (!g || !g.term || !g.plain) badBrief.push(`${t.id}.glossary.${(g && g.term) || "?"}`);
      else if (g.plain.includes(g.term)) badBrief.push(`${t.id}.glossary.${g.term}:plain 复述 term`);
    }
  }
  if (typeof t.entryCycle === "string" && !RE_ENTRY.test(t.entryCycle)) badBrief.push(`${t.id}.entryCycle 缺口径句`);
  if (typeof t.dataNote === "string" && !t.dataNote.includes("不代表某家公司实际要求")) badBrief.push(`${t.id}.dataNote 缺免责句`);
  if (!Number.isInteger(t.sampleSize)) badBrief.push(`${t.id}.sampleSize`);
}
check("tracks 13 方向说明书字段完整（glossary≥5 且 plain 不复述 term）", badBrief.length === 0, badBrief.slice(0, 8).join(",") || `${tracks.length} 个方向`);

// ---------------------------------------------------------------------------
// 12. 版本升档（R1-1：时效体系真实抽样；不改变既有「两文件一致」校验）
//    曾经的 3.4 一次性硬编码门槛已过时，改为「必须高于上一版 3.4」，
//    保证每次数据变更都强制升档（触发 DB 重新种子化），且未来不再卡死。
// ---------------------------------------------------------------------------
check("_meta.version 已升档（> 3.4）", jobsVer > "3.4" && skillsVer > "3.4", `jobs=${jobsVer} / skills=${skillsVer}`);

// ---------------------------------------------------------------------------
// 13. 别名体检报告（**不阻断**，但每次跑都打印，让「待清理清单」一直撞在眼前）
// ---------------------------------------------------------------------------
const aliasOwners = new Map();
const shortCjkAliases = [];
for (const sk of skills) {
  for (const alias of sk.aliases || []) {
    const key = String(alias).trim().toLowerCase();
    if (!key) continue;
    if (!aliasOwners.has(key)) aliasOwners.set(key, new Set());
    aliasOwners.get(key).add(sk.id);
    // ≤2 字中文别名：中文无词边界，最容易被嵌进无关长词里误命中
    if (String(alias).length <= 2 && /[\u4e00-\u9fff]/.test(String(alias))) {
      shortCjkAliases.push({ alias: String(alias), skill: sk.id });
    }
  }
}
lines.push(`· 别名体检：≤2 字中文别名 ${shortCjkAliases.length} 条（中文无词边界，需逐条确认是否会嵌进无关长词）`);
for (const { alias, skill } of shortCjkAliases) lines.push(`    「${alias}」← ${skill}`);

const aliasConflicts = [...aliasOwners.entries()]
  .filter(([, owners]) => owners.size >= 2)
  .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
lines.push(`· 别名体检：跨技能共用别名 ${aliasConflicts.length} 组（多义可能合理，需逐组判定）`);
for (const [alias, owners] of aliasConflicts) {
  lines.push(`    「${alias}」← ${[...owners].join(", ")}`);
}

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
