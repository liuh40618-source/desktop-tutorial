/**
 * 匹配与路径算法（产品核心，零 LLM 依赖）
 *
 * 设计原则：
 * 1. 所有数字都能追溯到计算过程，UI 必须能解释"这个分是怎么来的"。
 * 2. 覆盖率是主指标，不掺入无法解释的玄学权重。
 * 3. estHours 是经验估算，任何展示都必须标注"估算"。
 */

import { findSkillAliasOccurrences } from "./skill-matching.mjs";
import { resolveActionTemplate } from "./action-template.mjs";
import { levelFromScore } from "./candidate-level.mjs";
import type { CandidateLevel } from "./orientation";

export interface SkillRef {
  id: string;
  name: string;
  weight: number;
  estHours: number;
}

export interface ResourceRef {
  title: string;
  platform: string;
  query: string;
}

export interface JobMatch {
  jobId: string;
  source?: "template" | "jd";
  title: string;
  track: string;
  trackName: string;
  summary: string;
  /**
   * Legacy compatibility field. Kept for stored integrations; ranking uses `cosineSimilarity`.
   * It is not shown as the primary metric in the UI.
   */
  score: number;
  /** Cosine similarity between the user's binary skill vector and the occupation requirement vector (0–1). */
  cosineSimilarity: number;
  /** Signal detection summary over core vs non-core skills in this knowledge base; not a hiring probability. */
  signalDetection: { hitRate: number | null; falseAlarmRate: number | null; dPrime: number | null; criterion: number | null; hits: number; misses: number; falseAlarms: number | null; correctRejections: number | null };
  /** 主指标：必备技能加权覆盖率（0–100）。展示时应经 `coverageLevel()` 转成「高/中高/中/低」，不要直接露百分比 */
  coverage: number;
  /** 独立分项：加分项命中率（0–1），与覆盖率分开展示，不并入覆盖率 */
  plusRate: number;
  /** 独立分项：方向契合度（0–1；1 = 未勾选方向或无偏好，0.5 = 属于未勾选方向） */
  trackFit: number;
  covered: SkillRef[];
  missing: SkillRef[];
  plusCovered: string[];
  scarcityBonus: number;
  evidenceCoverage: number;
  supported: SkillRef[];
  weakEvidence: SkillRef[];
  /** Legacy score components retained for compatibility; not used for primary ranking. */
  scoreBreakdown: { coverage: number; bonus: number; direction: number };
  gapHours: number;
  etaWeeks: number;
  salary: { intern: string; junior: string };
  threshold: string;
  growth: string;
  reasons: string[];
}

/**
 * 技能覆盖率 → 等级纯函数（禁止百分比）。
 * 与开场定位**共用同一套阈值**（`orientation.levelFromScore`，0–10 量级）：
 * 覆盖率是 0–100，故先 `coverage / 10` 折算到 0–10 再套用，等价于 ≥70 高 / ≥40 中高 / ≥20 中 / 否则 低。
 * 非法 / 负数输入按 0 处理，绝不抛异常。
 */
export function coverageLevel(coverage: number): CandidateLevel {
  const c = Number.isFinite(coverage) ? Math.max(0, coverage) : 0;
  return levelFromScore(c / 10);
}

export interface PathItem {
  skillId: string;
  name: string;
  weight: number;
  estHours: number;
  priority: number;
  cumulativeWeeks: number;
  resources: ResourceRef[];
  kind: "learn" | "evidence";
  deliverable: string;
  acceptance: string;
  /** 交付物类型（供验收评判按类型取必含要素） */
  deliverableType: string;
  /** 该交付物类型的必含要素（供逐条自评与规则检测） */
  requiredElements: string[];
}

interface RawSkill {
  id: string;
  name: string;
  category: string;
  aliases: string[];
  estHours: number;
  marketFrequency?: number;
  resources: { title: string; platform: string }[];
  /** 技能级交付物覆盖（可选，来自 skills.json.action） */
  action?: { deliverableType?: string; deliverable?: string; acceptance?: string };
}

interface RawJob {
  id: string;
  title: string;
  track: string;
  summary: string;
  core: { s: string; w: number }[];
  plus: string[];
  threshold: string;
  salary: { intern: string; junior: string };
  growth: string;
}

let RAW_SKILLS: RawSkill[] = [];
let RAW_JOBS: RawJob[] = [];
let RAW_TRACKS: { id: string; name: string }[] = [];

export let SKILL_MAP: Record<string, RawSkill> = {};
export let TRACK_NAME: Record<string, string> = {};

/** 分类默认行动模板（data/action-templates.json.byCategory），缺省为空 → 走通用兜底 */
let ACTION_TEMPLATES: Record<string, { deliverableType?: string; deliverable?: string; acceptance?: string }> = {};
/** 交付物类型 → 必含要素（data/deliverable-types.json.types），缺省为空 */
let DELIVERABLE_TYPES: Record<string, { label?: string; requiredElements?: string[] }> = {};
/** O*NET 31.0 element IDs linked to local skills by an explicit crosswalk. */
let ONET_SKILL_MAPPINGS: Record<string, string[]> = {};

/**
 * 数据源注入：前端从 /api/knowledge 取数后调用，把知识库装进算法层。
 * 这样 matcher 不依赖任何静态 import，数据来源完全由数据库决定。
 * 新增字段全部可选、缺省安全 —— 最小 KB（tests/matcher.test.mjs）必须继续可用。
 */
export function initKB(data: {
  skills: unknown[];
  jobs: unknown[];
  tracks: { id: string; name: string }[];
  meta: { version: string; note: string; salaryNote: string };
  exclusions?: { contentOptions: unknown[]; contextOptions: unknown[] };
  starterSkills?: { items: unknown[] };
  deliverableTypes?: { types: Record<string, { label: string; requiredElements: string[] }> };
  actionTemplates?: { byCategory: Record<string, { deliverableType: string; deliverable: string; acceptance: string }> };
  knowledgeMeta?: { version: string; publishedAt: string; notes?: string };
  onet?: { skillMappings: Record<string, string[]> };
}) {
  RAW_SKILLS = data.skills as RawSkill[];
  RAW_JOBS = data.jobs as RawJob[];
  RAW_TRACKS = data.tracks;
  SKILL_MAP = Object.fromEntries(RAW_SKILLS.map((s) => [s.id, s]));
  TRACK_NAME = Object.fromEntries(RAW_TRACKS.map((t) => [t.id, t.name]));
  ACTION_TEMPLATES = data.actionTemplates?.byCategory ?? {};
  DELIVERABLE_TYPES = data.deliverableTypes?.types ?? {};
  ONET_SKILL_MAPPINGS = data.onet?.skillMappings ?? {};
  DATA_META = data.meta;
}

/** 数据元信息：版本与来源说明，供 UI 露出"数据可能落后"的透明提示 */
export let DATA_META: { version: string; note: string; salaryNote: string } = {
  version: "",
  note: "",
  salaryNote: "",
};

export function allSkills() {
  return RAW_SKILLS;
}

export function allTracks() {
  return RAW_TRACKS;
}

/** 岗位 id 全量集合：校验 localStorage 里的历史 id 是否仍然有效，避免数据变更后旧 id 让页面崩掉 */
export function jobIds(): Set<string> {
  return new Set(RAW_JOBS.map((j) => j.id));
}

function ref(id: string, weight: number): SkillRef {
  const s = SKILL_MAP[id];
  return { id, name: s.name, weight, estHours: s.estHours };
}

/**
 * 从自由文本里识别用户可能已掌握的技能；否定/不确定的邻近表述不自动计入。
 * 用于"自动预勾选"，用户再手动校正——不做静默判定，避免假数据。
 */
export function detectSkills(text: string, categories?: string[]): string[] {
  const hit: string[] = [];
  for (const s of RAW_SKILLS) {
    if (categories && !categories.includes(s.category)) continue;
    if (
      s.aliases.some((alias) =>
        findSkillAliasOccurrences(text || "", alias).some((occurrence) => !occurrence.negated && !occurrence.uncertain)
      )
    ) {
      hit.push(s.id);
    }
  }
  return hit;
}

export interface ProfileInput {
  evidenceLevels?: Record<string, number>;
  knownSkillIds?: string[];
  targetTracks?: string[];
  hoursPerWeek?: number;
  major?: string;
  grade?: string;
  experiences?: string;
  works?: string;
  certificates?: string;
  selfDescription?: string;
  interests?: string;
}

export function profileText(p: ProfileInput): string {
  return [p.major, p.grade, p.experiences, p.works, p.certificates, p.selfDescription, p.interests]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** 带命中原因的技能识别：返回命中到哪些技能、以及命中的是哪个别名/原文片段，供"能力翻译"展示"为什么这么判断" */
export interface SkillHit {
  id: string;
  name: string;
  category: string;
  hitAliases: string[];
  cautionAliases: string[];
}

export function detectSkillsDetailed(text: string, categories?: string[]): SkillHit[] {
  const hits: SkillHit[] = [];
  for (const s of RAW_SKILLS) {
    if (categories && !categories.includes(s.category)) continue;
    if (s.aliases.length === 0) continue;
    const matches = s.aliases
      .map((alias) => ({ alias, occurrences: findSkillAliasOccurrences(text || "", alias) }))
      .filter((item) => item.occurrences.length > 0);
    const hitAliases = matches.map((item) => item.alias);
    const cautionAliases = matches
      .filter((item) => item.occurrences.every((occurrence) => occurrence.negated || occurrence.uncertain))
      .map((item) => item.alias);
    if (hitAliases.length) hits.push({ id: s.id, name: s.name, category: s.category, hitAliases, cautionAliases });
  }
  return hits;
}

/** 匹配单个岗位：O*NET-aligned cosine similarity + template-label signal detection. */
export function matchJob(profile: ProfileInput, jobId: string): JobMatch {
  const job = RAW_JOBS.find((j) => j.id === jobId);
  if (!job) throw new Error("UNKNOWN_JOB");

  const known = new Set(profile.knownSkillIds || []);
  const hoursPerWeek = profile.hoursPerWeek && profile.hoursPerWeek > 0 ? profile.hoursPerWeek : 10;
  const tracks = new Set(profile.targetTracks || []);

  const covered: SkillRef[] = [];
  const missing: SkillRef[] = [];
  for (const c of job.core) {
    (known.has(c.s) ? covered : missing).push(ref(c.s, c.w));
  }

  const totalW = job.core.reduce((a, c) => a + c.w, 0);
  const coveredW = covered.reduce((a, s) => a + s.weight, 0);
  const coverage = totalW ? Math.round((coveredW / totalW) * 100) : 0;

  const plusCovered = (job.plus || []).filter((s) => known.has(s)).map((s) => SKILL_MAP[s].name);
  const plusRate = job.plus?.length ? plusCovered.length / job.plus.length : 0;
  const trackFit = tracks.size === 0 || tracks.has(job.track) ? 1 : 0.5;

  // 手工频率没有市场采样依据，不参与分数。证据覆盖独立展示，不冒充能力测评。
  const scarcityBonus = 0;
  const supported = covered.filter((s) => (profile.evidenceLevels?.[s.id] ?? 1) >= 3);
  const weakEvidence = covered.filter((s) => !supported.includes(s));
  const evidenceCoverage = totalW ? Math.round(supported.reduce((sum, s) => sum + s.weight, 0) / totalW * 100) : 0;
  // Cosine similarity over the full local skill vocabulary. Occupation core skills use
  // their curated importance weights; the profile is binary because self-report is not
  // a calibrated proficiency assessment.
  const features = (skillId: string) => ONET_SKILL_MAPPINGS[skillId]?.length ? ONET_SKILL_MAPPINGS[skillId]! : [`local:${skillId}`];
  const profileVector = new Map<string, number>();
  for (const skill of RAW_SKILLS) if (known.has(skill.id)) for (const feature of features(skill.id)) profileVector.set(feature, (profileVector.get(feature) ?? 0) + 1);
  const jobVector = new Map<string, number>();
  for (const item of job.core) for (const feature of features(item.s)) jobVector.set(feature, (jobVector.get(feature) ?? 0) + Math.max(0, item.w));
  const dot = [...jobVector].reduce((sum, [feature, value]) => sum + value * (profileVector.get(feature) ?? 0), 0);
  const profileNorm = Math.sqrt([...profileVector.values()].reduce((sum, value) => sum + value * value, 0));
  const jobNorm = Math.sqrt([...jobVector.values()].reduce((sum, value) => sum + value * value, 0));
  const cosineSimilarity = profileNorm && jobNorm ? dot / (profileNorm * jobNorm) : 0;

  // In this first pass, the core/non-core labels are the knowledge base's own job
  // template labels, not observed hiring outcomes. Apply the log-linear correction so
  // zero rates remain finite before converting hit/false-alarm rates to d'.
  const coreIds = new Set(job.core.map((item) => item.s));
  const hits = job.core.filter((item) => known.has(item.s)).length;
  const misses = job.core.length - hits;
  const negativeCount = RAW_SKILLS.filter((skill) => !coreIds.has(skill.id)).length;
  const falseAlarms = RAW_SKILLS.filter((skill) => !coreIds.has(skill.id) && known.has(skill.id)).length;
  const correctRejections = negativeCount - falseAlarms;
  const hitRate = (hits + 0.5) / (hits + misses + 1);
  const falseAlarmRate = (falseAlarms + 0.5) / (falseAlarms + correctRejections + 1);
  const normalQuantile = (p: number) => {
    // Peter J. Acklam's rational approximation to the inverse standard normal CDF.
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    const q = p - 0.5;
    if (Math.abs(q) <= 0.425) { const r = 0.180625 - q * q; return q * (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1); }
    const r = q < 0 ? p : 1 - p;
    const t = Math.sqrt(-Math.log(r));
    const value = (((((c[0]! * t + c[1]!) * t + c[2]!) * t + c[3]!) * t + c[4]!) * t + c[5]!) / ((((d[0]! * t + d[1]!) * t + d[2]!) * t + d[3]!) * t + 1);
    return q < 0 ? -value : value;
  };
  const dPrime = normalQuantile(hitRate) - normalQuantile(falseAlarmRate);
  const criterion = -0.5 * (normalQuantile(hitRate) + normalQuantile(falseAlarmRate));
  const signalDetection = { hitRate, falseAlarmRate, dPrime, criterion, hits, misses, falseAlarms, correctRejections };
  // Compatibility fields retain the old arithmetic for stored plans and legacy API
  // consumers. Ranking and UI use cosineSimilarity as the primary metric below.
  const scoreBreakdown = { coverage: coverage * 0.75, bonus: plusRate * 15, direction: trackFit * 10 };
  const score = Math.round(scoreBreakdown.coverage + scoreBreakdown.bonus + scoreBreakdown.direction);

  const gapHours = missing.reduce((a, s) => a + s.estHours, 0);
  const etaWeeks = Math.round((gapHours / hoursPerWeek) * 10) / 10;

  const reasons: string[] = [];
  reasons.push(`余弦相似度 ${(cosineSimilarity * 100).toFixed(1)}%（画像技能与岗位要求向量）`);
  reasons.push(`信号检测 d′ ${dPrime.toFixed(2)}（命中率 ${(hitRate * 100).toFixed(1)}%，误报率 ${(falseAlarmRate * 100).toFixed(1)}%；标签来自岗位模板核心/非核心技能）`);
  if (covered.length) {
    const hard = covered.filter((s) => s.weight === 3).map((s) => s.name);
    if (hard.length) reasons.push(`已具备硬门槛技能：${hard.join("、")}`);
  }
  if (missing.length) {
    const hard = missing.filter((s) => s.weight === 3).map((s) => s.name);
    reasons.push(
      hard.length ? `缺失关键门槛：${hard.join("、")}` : `待补齐项均为重要但非硬门槛：${missing.map((s) => s.name).join("、")}`
    );
  } else {
    reasons.push("自述技能已全部覆盖，仍需结合项目材料与真实 JD 复核");
  }
  if (plusCovered.length) reasons.push(`加分项已具备：${plusCovered.join("、")}`);
  reasons.push(`项目证据覆盖 ${evidenceCoverage}%（证据等级由用户自评，未经第三方验证）`);
  if (tracks.size && !tracks.has(job.track)) reasons.push(`该岗位属于你未勾选的方向；方向偏好单独记录，不改变技能相似度`);

  return {
    jobId: job.id,
    title: job.title,
    track: job.track,
    trackName: TRACK_NAME[job.track] || job.track,
    summary: job.summary,
    score,
    cosineSimilarity,
    signalDetection,
    coverage,
    plusRate,
    trackFit,
    covered: covered.sort((a, b) => b.weight - a.weight),
    missing: missing.sort((a, b) => b.weight - a.weight),
    plusCovered,
    scarcityBonus,
    evidenceCoverage,
    supported,
    weakEvidence,
    scoreBreakdown,
    gapHours,
    etaWeeks,
    salary: job.salary,
    threshold: job.threshold,
    growth: job.growth,
    reasons,
  };
}

/** 从已排序且有技能交集的模板中，选出不同方向供用户比较。 */
export function selectExplorations(matches: JobMatch[], targetTracks: string[] = []) {
  const eligible = matches.filter((m) => m.covered.length > 0);
  const choices: { match: JobMatch; label: string; reason: string }[] = [];
  const add = (match: JobMatch | undefined, label: string, reason: string) => {
    if (match) choices.push({ match, label, reason });
  };
  const best = eligible[0];
  add(best, "沿用已有能力", "有技能交集的模板中，技能向量余弦相似度最高");
  const preferred = eligible.find((m) => targetTracks.includes(m.track) && m.track !== best?.track);
  add(preferred, "回应你的意向", "在你勾选的其他方向中，当前匹配排序最靠前");
  const usedTracks = new Set(choices.map((c) => c.match.track));
  add(eligible.find((m) => !usedTracks.has(m.track)), "换个方向看看", "复用部分已有能力，选择一个不同方向的模板作比较");
  return choices;
}

/** 全部岗位按匹配分排序 */
export function rankJobs(profile: ProfileInput, limit = 8): JobMatch[] {
  // Primary order is weighted cosine similarity, followed by d' from the template labels.
  return RAW_JOBS.map((j) => matchJob(profile, j.id))
    .sort(
      (a, b) =>
        b.cosineSimilarity - a.cosineSimilarity ||
        (b.signalDetection.dPrime ?? -Infinity) - (a.signalDetection.dPrime ?? -Infinity) ||
        b.trackFit - a.trackFit ||
        b.plusRate - a.plusRate ||
        a.gapHours - b.gapHours
    )
    .slice(0, limit);
}

/**
 * 学习路径：按"性价比"排序——权重高、耗时短的先学。
 * priority = weight / estHours（归一化到 0-100，仅用于展示优先级）
 */
export function buildPath(profile: ProfileInput, jobId: string): PathItem[] {
  const m = matchJob(profile, jobId);
  return buildPathForMatch(profile, m);
}

export function buildJdPath(profile: ProfileInput, jd: { id: string; title: string; skills: string[] }): PathItem[] {
  return buildPathForMatch(profile, matchSavedJd(profile, jd));
}

function buildPathForMatch(profile: ProfileInput, m: JobMatch): PathItem[] {
  const hoursPerWeek = profile.hoursPerWeek && profile.hoursPerWeek > 0 ? profile.hoursPerWeek : 10;

  const raw = [...m.missing, ...m.weakEvidence].map((s) => {
    const kind = m.missing.includes(s) ? "learn" as const : "evidence" as const;
    const estHours = kind === "learn" ? Math.max(1, s.estHours) : Math.max(2, Math.ceil(s.estHours * 0.2));
    return { skill: { ...s, estHours }, kind, value: s.weight / estHours };
  }).sort((a, b) => b.skill.weight - a.skill.weight || b.value - a.value);

  const maxValue = Math.max(1, ...raw.map((r) => r.value));
  let acc = 0;

  return raw.map(({ skill, value, kind }) => {
    acc += skill.estHours;
    return {
      skillId: skill.id,
      kind,
      ...actionTemplate(skill.id, skill.name, SKILL_MAP[skill.id]?.category),
      name: skill.name,
      weight: skill.weight,
      estHours: skill.estHours,
      priority: Math.round((value / maxValue) * 100),
      cumulativeWeeks: Math.round((acc / hoursPerWeek) * 10) / 10,
      resources: (SKILL_MAP[skill.id].resources || []).map((r) => ({
        title: r.title,
        platform: r.platform,
        query: `${r.title} ${skill.name}`.trim(),
      })),
    };
  });
}

/**
 * 交付物 + 验收标准（四级解析，共享 lib/action-template.mjs，避免与校验器两份实现）：
 *   ① skills[].action（技能级） → ② actionTemplates.byCategory[category]（{skill} 替换）
 *   → ③ deliverable-types（按类型合成） → ④ 通用兜底（永不为空）
 * 缺省 KB（无 actionTemplates / deliverableTypes）时走 ④，与旧兜底行为一致。
 */
export function actionTemplate(id: string, name: string, category?: string) {
  const skill = SKILL_MAP[id];
  return resolveActionTemplate(
    { id, name, category: category ?? skill?.category, action: skill?.action },
    ACTION_TEMPLATES,
    DELIVERABLE_TYPES
  );
}

export function buildGapMap(profile: ProfileInput, jobIds: string[]) {
  const jobs = jobIds.map((id) => matchJob(profile, id));
  return buildGapMapForMatches(profile, jobs);
}

export function buildGapMapForMatches(profile: ProfileInput, jobs: JobMatch[]) {
  const known = new Set(profile.knownSkillIds || []);
  const skillIds = Array.from(new Set(jobs.flatMap((j) => [...j.covered, ...j.missing].map((s) => s.id))));
  return {
    jobs: jobs.map((j) => ({ jobId: j.jobId, title: j.title, coverage: j.coverage, score: j.score })),
    skills: skillIds.map((id) => ({
      id,
      name: SKILL_MAP[id].name,
      known: known.has(id),
      estHours: SKILL_MAP[id].estHours,
      requiredByJobIds: jobs.filter((j) => [...j.covered, ...j.missing].some((s) => s.id === id)).map((j) => j.jobId),
    })),
  };
}

/* ============================================================
   真实 JD 匹配（用户收藏的岗位 JD → 抽取技能后与本画像比对）
   JD 文本本身没有权重信息：抽取到的技能一律按「重要(2)」对待，
   并在 reasons 里如实说明，不做虚假的硬门槛分级。
   ============================================================ */
export interface JdMatch {
  coverage: number;
  covered: SkillRef[];
  missing: SkillRef[];
  supported: SkillRef[];
  weakEvidence: SkillRef[];
  evidenceCoverage: number;
  gapHours: number;
  etaWeeks: number;
  reasons: string[];
}

export function matchJdSkills(profile: ProfileInput, jdSkillIds: string[]): JdMatch {
  const known = new Set(profile.knownSkillIds || []);
  const hoursPerWeek = profile.hoursPerWeek && profile.hoursPerWeek > 0 ? profile.hoursPerWeek : 10;
  const covered: SkillRef[] = [];
  const missing: SkillRef[] = [];
  const validIds = [...new Set(jdSkillIds)].filter((id) => SKILL_MAP[id]);
  for (const id of validIds) {
    if (!SKILL_MAP[id]) continue;
    (known.has(id) ? covered : missing).push(ref(id, 2));
  }
  const totalW = validIds.length * 2;
  const coverage = totalW ? Math.round((covered.reduce((a, s) => a + s.weight, 0) / totalW) * 100) : 0;
  const supported = covered.filter((s) => (profile.evidenceLevels?.[s.id] ?? 1) >= 3);
  const weakEvidence = covered.filter((s) => (profile.evidenceLevels?.[s.id] ?? 1) < 3);
  const evidenceCoverage = validIds.length ? Math.round((supported.length / validIds.length) * 100) : 0;
  const gapHours = missing.reduce((a, s) => a + s.estHours, 0);
  const etaWeeks = Math.round((gapHours / hoursPerWeek) * 10) / 10;

  const reasons: string[] = [];
  if (!validIds.length) {
    reasons.push("这份 JD 里没有识别到知识库里的技能关键词，可能 JD 写法与库中词条对不上");
  } else {
    reasons.push(
      `这份 JD 识别到的技能里你已具备 ${covered.length}/${covered.length + missing.length} 项（等权覆盖 ${coverage}%）`
    );
    if (missing.length) {
      reasons.push(`还没具备：${missing.map((s) => s.name).join("、")}`);
    } else {
      reasons.push("已覆盖所有识别到的技能；这不代表满足 JD 全部要求，请继续核对原文");
    }
    reasons.push("JD 没有权重信息，识别到的技能按等权比较，不代表招聘方重要程度；请结合原文确认优先级");
  }
  reasons.push("此结果只比较知识库中识别到的技能，不评估年限、学历、职责或其他隐性条件");
  return { coverage, covered, missing, supported, weakEvidence, evidenceCoverage, gapHours, etaWeeks, reasons };
}

/** 把用户确认保存的真实 JD 转成主流程共用的岗位结果；不虚构薪资、门槛或技能权重。 */
export function matchSavedJd(profile: ProfileInput, jd: { id: string; title: string; skills: string[] }): JobMatch {
  const result = matchJdSkills(profile, jd.skills);
  return {
    jobId: `jd:${jd.id}`,
    source: "jd",
    title: jd.title || "未命名真实岗位",
    track: "jd",
    trackName: "真实 JD",
    summary: `根据你确认保存的 JD，规则识别到 ${result.covered.length + result.missing.length} 项知识库技能。识别结果请对照原文复核。`,
    score: result.coverage,
    cosineSimilarity: result.coverage / 100,
    signalDetection: {
      hitRate: null,
      falseAlarmRate: null,
      dPrime: null,
      criterion: null,
      hits: result.covered.length,
      misses: result.missing.length,
      falseAlarms: null,
      correctRejections: null,
    },
    coverage: result.coverage,
    // 真实 JD 无方向信息、无加分项：trackFit 记中性 1，plusRate 记 0（不虚构）。
    plusRate: 0,
    trackFit: 1,
    covered: result.covered,
    missing: result.missing,
    plusCovered: [],
    scarcityBonus: 0,
    evidenceCoverage: result.evidenceCoverage,
    supported: result.supported,
    weakEvidence: result.weakEvidence,
    // ⚠️ 仅供兼容：保持旧值（direction=0）以不改动 JD 的 score，UI 不得作为主指标展示。
    scoreBreakdown: { coverage: result.coverage, bonus: 0, direction: 0 },
    gapHours: result.gapHours,
    etaWeeks: result.etaWeeks,
    salary: { intern: "以原始 JD 为准", junior: "以原始 JD 为准" },
    threshold: "请以原始 JD 为准",
    growth: "用户保存的真实 JD",
    reasons: result.reasons,
  };
}
