/**
 * 匹配与路径算法（产品核心，零 LLM 依赖）
 *
 * 设计原则：
 * 1. 所有数字都能追溯到计算过程，UI 必须能解释"这个分是怎么来的"。
 * 2. 覆盖率是主指标，不掺入无法解释的玄学权重。
 * 3. estHours 是经验估算，任何展示都必须标注"估算"。
 */


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
  title: string;
  track: string;
  trackName: string;
  summary: string;
  score: number;
  coverage: number;
  covered: SkillRef[];
  missing: SkillRef[];
  plusCovered: string[];
  gapHours: number;
  etaWeeks: number;
  salary: { intern: string; junior: string };
  threshold: string;
  growth: string;
  reasons: string[];
}

export interface PathItem {
  skillId: string;
  name: string;
  weight: number;
  estHours: number;
  priority: number;
  cumulativeWeeks: number;
  resources: ResourceRef[];
}

interface RawSkill {
  id: string;
  name: string;
  category: string;
  aliases: string[];
  estHours: number;
  resources: { title: string; platform: string }[];
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

/**
 * 数据源注入：前端从 /api/knowledge 取数后调用，把知识库装进算法层。
 * 这样 matcher 不依赖任何静态 import，数据来源完全由数据库决定。
 */
export function initKB(data: {
  skills: any[];
  jobs: any[];
  tracks: { id: string; name: string }[];
  meta: { version: string; note: string; salaryNote: string };
}) {
  RAW_SKILLS = data.skills as RawSkill[];
  RAW_JOBS = data.jobs as RawJob[];
  RAW_TRACKS = data.tracks;
  SKILL_MAP = Object.fromEntries(RAW_SKILLS.map((s) => [s.id, s]));
  TRACK_NAME = Object.fromEntries(RAW_TRACKS.map((t) => [t.id, t.name]));
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
 * 从自由文本里识别用户可能已掌握的技能（aliases 命中即算）
 * 用于"自动预勾选"，用户再手动校正——不做静默判定，避免假数据。
 */
export function detectSkills(text: string, categories?: string[]): string[] {
  const t = (text || "").toLowerCase();
  const hit: string[] = [];
  for (const s of RAW_SKILLS) {
    if (categories && !categories.includes(s.category)) continue;
    if (s.aliases.some((a) => t.includes(a.toLowerCase()))) hit.push(s.id);
  }
  return hit;
}

export interface ProfileInput {
  knownSkillIds?: string[];
  targetTracks?: string[];
  hoursPerWeek?: number;
  major?: string;
  grade?: string;
  works?: string;
  certificates?: string;
  selfDescription?: string;
  interests?: string;
}

export function profileText(p: ProfileInput): string {
  return [p.major, p.grade, p.works, p.certificates, p.selfDescription, p.interests]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** 匹配单个岗位：覆盖率为主，加分项与方向契合为辅 */
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
  const trackRate = tracks.size === 0 || tracks.has(job.track) ? 1 : 0.5;

  // 覆盖率 75% + 加分项 15% + 方向契合 10%。权重公开，UI 可解释。
  const score = Math.round(coverage * 0.75 + plusRate * 100 * 0.15 + trackRate * 100 * 0.1);

  const gapHours = missing.reduce((a, s) => a + s.estHours, 0);
  const etaWeeks = Math.round((gapHours / hoursPerWeek) * 10) / 10;

  const reasons: string[] = [];
  reasons.push(
    `必备技能覆盖 ${covered.length}/${job.core.length} 项（按权重计 ${coverage}%）`
  );
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
    reasons.push("必备技能已全部覆盖，可直接投递试试");
  }
  if (plusCovered.length) reasons.push(`加分项已具备：${plusCovered.join("、")}`);
  if (tracks.size && !tracks.has(job.track)) reasons.push(`该岗位属于你未勾选的方向，匹配分已打折`);

  return {
    jobId: job.id,
    title: job.title,
    track: job.track,
    trackName: TRACK_NAME[job.track] || job.track,
    summary: job.summary,
    score,
    coverage,
    covered: covered.sort((a, b) => b.weight - a.weight),
    missing: missing.sort((a, b) => b.weight - a.weight),
    plusCovered,
    gapHours,
    etaWeeks,
    salary: job.salary,
    threshold: job.threshold,
    growth: job.growth,
    reasons,
  };
}

/** 全部岗位按匹配分排序 */
export function rankJobs(profile: ProfileInput, limit = 8): JobMatch[] {
  return RAW_JOBS.map((j) => matchJob(profile, j.id))
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.gapHours - b.gapHours)
    .slice(0, limit);
}

/**
 * 学习路径：按"性价比"排序——权重高、耗时短的先学。
 * priority = weight / estHours（归一化到 0-100，仅用于展示优先级）
 */
export function buildPath(profile: ProfileInput, jobId: string): PathItem[] {
  const m = matchJob(profile, jobId);
  const hoursPerWeek = profile.hoursPerWeek && profile.hoursPerWeek > 0 ? profile.hoursPerWeek : 10;

  const raw = m.missing.map((s) => ({
    skill: s,
    value: s.weight / s.estHours,
  })).sort((a, b) => b.value - a.value);

  const maxValue = raw.length ? raw[0].value : 1;
  let acc = 0;

  return raw.map(({ skill, value }) => {
    acc += skill.estHours;
    return {
      skillId: skill.id,
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

/** 某方向下各岗位的技能覆盖热力图数据（差距地图） */
export function buildGapMap(profile: ProfileInput, jobIds: string[]) {
  const known = new Set(profile.knownSkillIds || []);
  const jobs = jobIds.map((id) => matchJob(profile, id));
  const skillIds = Array.from(new Set(jobs.flatMap((j) => [...j.covered, ...j.missing].map((s) => s.id))));
  return {
    jobs: jobs.map((j) => ({ jobId: j.jobId, title: j.title, coverage: j.coverage, score: j.score })),
    skills: skillIds.map((id) => ({
      id,
      name: SKILL_MAP[id].name,
      known: known.has(id),
      estHours: SKILL_MAP[id].estHours,
      requiredBy: jobs.filter((j) => [...j.covered, ...j.missing].some((s) => s.id === id)).map((j) => j.title),
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
  gapHours: number;
  etaWeeks: number;
  reasons: string[];
}

export function matchJdSkills(profile: ProfileInput, jdSkillIds: string[]): JdMatch {
  const known = new Set(profile.knownSkillIds || []);
  const hoursPerWeek = profile.hoursPerWeek && profile.hoursPerWeek > 0 ? profile.hoursPerWeek : 10;
  const covered: SkillRef[] = [];
  const missing: SkillRef[] = [];
  for (const id of jdSkillIds) {
    if (!SKILL_MAP[id]) continue;
    (known.has(id) ? covered : missing).push(ref(id, 2));
  }
  const totalW = jdSkillIds.length * 2;
  const coverage = totalW ? Math.round((covered.reduce((a, s) => a + s.weight, 0) / totalW) * 100) : 0;
  const gapHours = missing.reduce((a, s) => a + s.estHours, 0);
  const etaWeeks = Math.round((gapHours / hoursPerWeek) * 10) / 10;

  const reasons: string[] = [];
  if (!jdSkillIds.length) {
    reasons.push("这份 JD 里没有识别到知识库里的技能关键词，可能 JD 写法与库中词条对不上");
  } else {
    reasons.push(
      `这份 JD 提到的要求里你已具备 ${covered.length}/${covered.length + missing.length} 项（按权重计 ${coverage}%）`
    );
    if (missing.length) {
      reasons.push(`还没具备：${missing.map((s) => s.name).join("、")}`);
    } else {
      reasons.push("JD 提到的技能你都覆盖了，可以对照岗位要求逐条复核后投递");
    }
    reasons.push("JD 没有权重信息，抽取到的技能一律按「重要」对待；建议结合 JD 原文确认优先级");
  }
  return { coverage, covered, missing, gapHours, etaWeeks, reasons };
}
