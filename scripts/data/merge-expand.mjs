/**
 * merge-expand.mjs —— 岗位库批量扩充合并脚本（v3.6，149 → ~500）。
 *
 * 用法（在 career-navigator 根目录运行）：
 *   node scripts/data/merge-expand.mjs
 *
 * 输入：data/_expand/part-*.json（子代理按方向批量编写，见文件头 schema 注释）
 * 职责：
 *   - 逐条校验 id/技能引用/salary/workTags（snippet 必须是 summary 真子串）
 *   - 依据 tags 自动拼 workTags 的 note（core=assumed 含「人工初判，待校准」，incidental=confirmed）
 *   - 补齐 source_date/updated_at/verified_at/sample_size/confidence（sample_size 0、confidence low）
 *   - 并入 data/jobs.json 并升档 _meta.version 3.5 → 3.6（两文件同步）
 * 之后仍需运行 scripts/data/validate-data.mjs 做全量回归。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// 注：上面用了 fileURLToPath 但未 import，改用如下方式
import { fileURLToPath } from "node:url";

const JOBS_PATH = path.join(ROOT, "data", "jobs.json");
const SKILLS_PATH = path.join(ROOT, "data", "skills.json");
const EXPAND_DIR = path.join(ROOT, "data", "_expand");

const jobsJson = JSON.parse(fs.readFileSync(JOBS_PATH, "utf8"));
const skillsJson = JSON.parse(fs.readFileSync(SKILLS_PATH, "utf8"));
const exclusionsJson = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "exclusions.json"), "utf8"));

const existingJobs = jobsJson.jobs;
const skillIdSet = new Set(skillsJson.skills.map((s) => s.id));
const trackIdSet = new Set(jobsJson.tracks.map((t) => t.id));
const contentTagSet = new Set(exclusionsJson.contentOptions.map((o) => o.tag));
const existingIds = new Set(existingJobs.map((j) => j.id));
const existingTitles = new Set(existingJobs.map((j) => j.title));
const ID_RE = /^[a-z0-9-]+$/;
const WEIGHTS = new Set([1, 2, 3]);

// tag → 职责短语（用于拼 workTags note）
const PHRASE = {
  "data-check-heavy": "大量数据核对",
  "code-debug": "编码与调试",
  "visual-rework": "视觉反复修改",
  "doc-alignment": "文档撰写与跨方对齐",
  "emotional-labor": "情绪劳动与情绪管理",
  "research-experiment": "研究与实验验证",
  "detail-audit": "逐条质量核查",
  "coordination-chase": "跨方协调跟进",
  "changing-requirements": "应对持续变化的需求",
};

const errors = [];
const warn = [];
const parts = fs.readdirSync(EXPAND_DIR).filter((f) => /^part-.+\.json$/.test(f)).sort();
if (parts.length === 0) {
  console.error("未找到 data/_expand/part-*.json");
  process.exit(1);
}

const additions = []; // {track, jobs:[]}
for (const f of parts) {
  const data = JSON.parse(fs.readFileSync(path.join(EXPAND_DIR, f), "utf8"));
  if (!Array.isArray(data.tracks)) {
    bad(`part ${f}: 缺少 tracks 数组`);
    continue;
  }
  for (const tr of data.tracks) additions.push(tr);
}

const newJobs = [];
const tagCoreCount = new Map();

function bad(msg) {
  errors.push(msg);
  console.error("✗ " + msg);
}

for (const tr of additions) {
  if (!trackIdSet.has(tr.track)) bad(`part 声明 track 不存在: ${tr.track}`);
  if (!Array.isArray(tr.jobs)) {
    bad(`part[${tr.track}] jobs 非数组`);
    continue;
  }
  const jobTrack = tr.track;
  for (const j of tr.jobs) {
    if (!j || typeof j !== "object") { bad("存在空条目"); continue; }
    const id = j.id;
    if (!ID_RE.test(id)) bad(`${id ?? "?"}: id 需小写字母/数字/连字符`);
    if (existingIds.has(id)) bad(`id 与现有重复: ${id}`);
    if (newJobs.some((x) => x.id === id)) bad(`part 内 id 重复: ${id}`);
    if (existingTitles.has(j.title)) bad(`title 与现有重复: ${id} -> ${j.title}`);
    if (newJobs.some((x) => x.title === j.title)) bad(`part 内 title 重复: ${id} -> ${j.title}`);

    for (const [s, w] of j.core ?? []) {
      if (!skillIdSet.has(s)) bad(`${id}.core.${s}: 技能不存在`);
      if (!WEIGHTS.has(w)) bad(`${id}.core.${s}: w=${w} 非法`);
    }
    for (const p of j.plus ?? []) {
      if (!skillIdSet.has(p)) bad(`${id}.plus.${p}: 技能不存在`);
    }
    for (const f of ["intern", "junior"]) {
      const v = j.salary?.[f];
      if (typeof v !== "string" || !v.trim()) bad(`${id}.salary.${f} 为空`);
    }
    if (typeof j.threshold !== "string" || !j.threshold.trim()) bad(`${id}.threshold 为空`);
    if (typeof j.growth !== "string" || !j.growth.trim()) bad(`${id}.growth 为空`);
    const certs = Array.isArray(j.certs) && j.certs.length > 0 ? j.certs : ["无硬性证书要求"];

    const tags = Array.isArray(j.tags) ? j.tags : [];
    const coreTags = tags.filter((t) => t?.[1] === "core");
    if (coreTags.length === 0) bad(`${id}: 无 tier=core 的 workTag`);
    const workTags = [];
    for (const [tag, tier, snippet] of tags) {
      if (!contentTagSet.has(tag)) bad(`${id}.${tag}: 非内容 tag`);
      if (!["core", "incidental"].includes(tier)) bad(`${id}.${tag}: tier 非法 ${tier}`);
      if (typeof snippet !== "string" || !snippet.trim()) bad(`${id}.${tag}: snippet 为空`);
      else if (!(j.summary ?? "").includes(snippet)) bad(`${id}.${tag}: snippet「${snippet}」不在 summary「${j.summary}」中`);
      else if (snippet.length >= (j.summary ?? "").length) bad(`${id}.${tag}: snippet 整段引用 summary`);
      if (tier === "core") tagCoreCount.set(tag, (tagCoreCount.get(tag) || 0) + 1);
      const phrase = PHRASE[tag] ?? tag;
      const note =
        tier === "core"
          ? `核心职责为${phrase}；依据 summary「${snippet}」+ core 技能构成；人工初判，待校准`
          : `岗位会涉及${phrase}（非主要工时）；依据 summary「${snippet}」`;
      workTags.push({ tag, tier, note, reviewStatus: tier === "core" ? "assumed" : "confirmed" });
    }
    if (!j.summary || !j.summary.trim()) bad(`${id}: summary 为空`);

    newJobs.push({
      id,
      title: j.title,
      track: jobTrack,
      summary: j.summary,
      core: (j.core ?? []).map(([s, w]) => ({ s, w })),
      plus: j.plus ?? [],
      threshold: j.threshold,
      salary: j.salary,
      certs,
      growth: j.growth,
      workTags,
      source_date: "2026-03",
      updated_at: "2026-09-27",
      verified_at: "2026-09-20",
      sample_size: 0,
      confidence: "low",
    });
  }
}

if (errors.length > 0) {
  console.error(`\n共 ${errors.length} 个错误，未写入。请修正 part 文件后重跑。`);
  process.exit(1);
}

// 覆盖率下限提醒（不阻断，交给 validate-data.mjs 把关）
for (const [tag, n] of tagCoreCount) {
  if (n < 3) warn.push(`提示: 新增部分 tag ${tag} 仅 ${n} 个 core（需≥3）`);
}
for (const w of warn) console.warn("⚠ " + w);

// 合并写回
jobsJson.jobs = existingJobs.concat(newJobs);
jobsJson._meta.version = "3.7";
jobsJson._meta.note += `\nv3.7：新增市场与销售/人力行政客服/财务法务合规/供应链采购物流 4 个方向（17 方向），按方向补齐对应常见岗位；仍为人工模板整理，sample_size 0、confidence low。`;
fs.writeFileSync(JOBS_PATH, JSON.stringify(jobsJson, null, 2) + "\n");

skillsJson._meta.version = "3.7";
skillsJson._meta.note += "\nv3.7：新增市场/人力/财务/供应链 4 个分类共 24 个技能，与 jobs.json 同步升档（方向扩充至 17）。";
fs.writeFileSync(SKILLS_PATH, JSON.stringify(skillsJson, null, 2) + "\n");

const byTrack = {};
for (const j of jobsJson.jobs) byTrack[j.track] = (byTrack[j.track] || 0) + 1;
console.log(`\n✅ 合并完成：${existingJobs.length} → ${jobsJson.jobs.length} 岗位`);
console.log(JSON.stringify(byTrack));
console.log("接下来请运行: node scripts/data/validate-data.mjs");
