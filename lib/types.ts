/**
 * 跨页面共享的 TypeScript 类型与默认值
 */

export interface Profile {
  major: string;
  grade: string;
  /** 自然语言经历：让用户用自己的话描述"做过什么、负责哪部分、用了什么工具、解决了什么问题、产生了什么结果" */
  experiences: string;
  /** 结构化经历分栏（第 1 步采集），experiences 是其合并文本，保留两处一致 */
  experienceParts?: ExperienceParts;
  /** 经历类型（选填），与 experienceTimeline 一同作为「年度能力表」前置 */
  experienceType?: "course" | "competition" | "club" | "internship" | "parttime" | "personal" | "none";
  /** 经历发生时间（如 "2025 秋"），年度能力表前置，本轮只存不展示 */
  experienceTimeline?: string;
  works: string;
  certificates: string;
  selfDescription: string;
  interests: string;
  knownSkillIds: string[];
  customSkills: string[];
  /** 映射来源的「一次性临时技能」（同时存在于 knownSkillIds），保存本次规划后自动移除 */
  tempSkillIds: string[];
  /** 技能 → 证据等级（0-5）。把「是否具备」升级成「有多硬的证据证明」 */
  evidenceLevels: Record<string, number>;
  targetTracks: string[];
  hoursPerWeek: number;
  goal: string;
  completedActions?: string[];
  actionReviews?: Record<string, ActionReview>;
  /** 独立职业试驾记录，不要求先填写经历或确认技能。 */
  trialAttempts?: TrialAttempt[];
  /** 开场定位结果（独立前置门，不占用 step；老草稿缺该字段视为 skipped=true） */
  orientation?: OrientationResult;
  /** 候选卡四态中的后两态：暂不确定 / 已修改（既不确认也不否认） */
  pendingCandidates?: Record<string, "uncertain" | "modified">;
  /** 产出物评判记录：key = actionId `${jobId}:${skillId}:${kind}` */
  actionEvaluations?: Record<string, ActionEvaluation>;
  /** 每条能力的证据文本（简历面板导出前置，本轮只存不展示） */
  evidenceText?: Record<string, string>;
  /** 每条能力的量化结果（简历面板导出前置，本轮只存不展示） */
  evidenceResult?: Record<string, string>;
}

export interface TrialAttempt {
  id: string;
  taskId: string;
  status: "in-progress" | "completed";
  answers: Record<string, string>;
  startedAt: number;
  completedAt?: number;
  reflection: string;
  interest: "continue" | "uncertain" | "stop" | "";
}

export interface ActionReview {
  artifact: string;
  location: string;
  contribution: string;
  reflection: string;
  interest: "continue" | "uncertain" | "stop" | "";
}

/* ============================================================
   增量 v0.1 新增类型（PRD 4.5 / 4.9，架构 §3.2）
   ============================================================ */

/** 开场候选方向的等级：只用档位，禁止百分比 */
export type CandidateLevel = "高" | "中高" | "中" | "低";

/** 时效档位（与 lib/freshness.ts 的 Freshness 同构） */
export type FreshnessLevel = "fresh" | "referenceable" | "needs_review" | "outdated";

/** 岗位工作标签（真源在 jobs.json.workTags，镜像到 job_work_tags） */
export interface WorkTag {
  /** 标签 id，必须存在于 data/exclusions.json（内容 tag ∪ 条件 tag） */
  tag: string;
  /** 仅 core 触发排除；incidental 仅用于展示「该方向偶尔涉及，未排除」 */
  tier: "core" | "incidental";
  /** 判定依据来源：summary | core | threshold | growth | 真实 JD 职责描述 */
  note: string;
  /** confirmed = 有明确依据支撑；assumed = 人工初判待校准 */
  reviewStatus: "confirmed" | "assumed";
}

/** ★ 候选以 trackId 为主键（方向级），不再用 jobId */
export interface OrientationCandidate {
  trackId: string;
  trackName: string;
  level: CandidateLevel;
  /** 「依据」栏 */
  reasons: string[];
  /** 「待确认」栏 */
  pending: string[];
  /** 1–2 个代表岗位，仅作示例说明 */
  sampleJobIds: string[];
}

export interface OrientationResult {
  /** 勾选的 contentOptions.id */
  contentExcluded: string[];
  /** 勾选的 contextOptions.id */
  contextExcluded: string[];
  excludedJobIds: string[];
  /**
   * 岗位级排除明细。9 个内容选项里有 5 个只在岗位级生效（排不掉整个方向），
   * 输出页必须能渲染「另排除 N 个具体岗位（你不想写文档）：数据分析师、BI 工程师……」。
   * tagIds 用于归因到用户勾了哪几项。
   */
  excludedJobs: { jobId: string; title: string; trackId: string; tagIds: string[] }[];
  excludedTrackIds: string[];
  /** 部分相关，未整体排除 */
  partialTrackIds: string[];
  /** 方向级 Top 3 候选 */
  candidates: OrientationCandidate[];
  excludedReasons: { trackId: string; trackName: string; reason: string; assumed: boolean }[];
  /**
   * 条件排除是否生效，恒定 `false`（字面量类型）。
   * 用户已拍板：第 2 步「工作条件」保留但降级为「自我清单」，不做硬排除——
   * 知识库暂无工作条件字段（133 岗模板只有技能 / 门槛 / 薪资 / 发展四类数据），
   * 原「候选 <3 才降级」的语义作废，现在是**恒定不排除**。
   */
  contextExclusionApplied: false;
  skipped: boolean;
  completedAt: number;
}

/** 产出物评判记录（P0-15/17，零 LLM 规则层） */
export interface ActionEvaluation {
  /** `${jobId}:${skillId}:${kind}` */
  actionId: string;
  deliverableType: string;
  requiredElements: string[];
  confirmedElements: string[];
  /** 规则检测命中的要素（供「我看了你的什么」） */
  ruleHits: string[];
  artifactTitle?: string;
  /** 简历面板导出前置；非空才可能到等级 4 */
  artifactLocation?: string;
  /** 简历面板导出前置 */
  quantitativeResult?: string;
  /** 规则层建议 1–4 */
  suggestedLevel: number;
  /** 用户可推翻后的最终值 */
  finalLevel: number;
  overridden: boolean;
  /** Q8：零 LLM 下的「申请复核」 */
  reviewRequested?: boolean;
  reviewReason?: string;
  note?: string;
  /** 年度能力表前置（时间戳） */
  evaluatedAt: number;
}

/** 结构化经历分栏（PRD 4.5 扩展，全部新增字段可选，向后兼容） */
export interface ExperienceParts {
  /** 新增：项目 / 经历名称 */
  title?: string;
  what: string;
  part: string;
  /** 新增：负责部分多选（见 PRD 4.5 partTags 表） */
  partTags?: string[];
  /** 新增：选中「其他（自由填写）」时的补充说明，只记录不参与技能识别文本 */
  partTagsOther?: string;
  tools: string;
  problem: string;
  result: string;
  /** 新增：有无交付物 */
  hasDeliverable?: "yes" | "no" | "unsure";
  /** 新增：交付物说明（hasDeliverable === 'yes' 时展示） */
  deliverableNote?: string;
}

export const emptyProfile: Profile = {
  major: "",
  grade: "",
  experiences: "",
  works: "",
  certificates: "",
  selfDescription: "",
  interests: "",
  knownSkillIds: [],
  customSkills: [],
  tempSkillIds: [],
  evidenceLevels: {},
  targetTracks: [],
  hoursPerWeek: 10,
  goal: "",
};

/** 证据等级：从「说出来」到「有硬核材料」的强弱刻度，用户自己评、不靠 AI 猜 */
export const EVIDENCE_LEVELS: { level: number; label: string; desc: string }[] = [
  { level: 0, label: "未提及", desc: "什么材料都没提到" },
  { level: 1, label: "自述了解", desc: "只是说自己会/了解" },
  { level: 2, label: "课程或练习", desc: "上过课、做过练习" },
  { level: 3, label: "实际项目", desc: "做过真实项目" },
  { level: 4, label: "成果或作品", desc: "有明确成果/作品可展示" },
  { level: 5, label: "岗位或实习", desc: "有真实岗位/实习经验" },
];

export function evidenceLabel(level: number): string {
  return EVIDENCE_LEVELS.find((e) => e.level === level)?.label ?? "未提及";
}

/** 一键体验示例数据（计算机专业大三学生，15项通用技能） */
export const DEMO_PROFILE: Profile = {
  major: "计算机科学与技术",
  grade: "大三",
  experiences:
    "做过一份问卷调研，我负责数据整理和统计，用 Excel 和 Python 清洗过原始数据，还给小组做过结果图表；后来自己独立开发了职途这个简历匹配工具，做了前后端和匹配算法",
  experienceParts: {
    what: "为社团办过一次问卷调研，也独立开发了「职途」简历匹配工具",
    part: "问卷调研里我负责回收并整理全部问卷；开发工具时独立负责前后端与匹配算法",
    tools: "Excel、Python、剔除无效答卷、分类统计；Next.js、TypeScript、SQLite",
    problem: "答卷质量参差，数据难以汇总；简历与岗位匹配全靠人工，费时且主观",
    result: "整理出 328 份有效问卷，输出分类统计和 3 张图表；工具上线后完成前后端开发与匹配算法",
  },
  works: "基于 Next.js 的在线简历匹配工具（职途 career-navigator），独立完成前后端开发与数据设计与算法实现",
  certificates: "英语四级，计算机二级（Python）",
  selfDescription: "对数据分析和 AI 应用感兴趣，有前后端开发基础，正在系统学习机器学习与数据工程相关技能",
  interests: "数据分析、AI 应用、全栈开发",
  knownSkillIds: [
    "python", "sql", "excel", "git", "linux", "algo-basic", "tech-english",
    "html-css", "js", "ts", "node",
    "data-clean", "data-viz", "pandas", "ml-basics",
  ],
  customSkills: [],
  tempSkillIds: [],
  evidenceLevels: {
    "python": 4, "sql": 3, "excel": 3, "data-clean": 3, "data-viz": 3,
    "pandas": 3, "ml-basics": 2, "js": 4, "ts": 4, "node": 4, "html-css": 4, "git": 3,
  },
  targetTracks: ["data", "ai", "frontend", "backend"],
  hoursPerWeek: 10,
  goal: "三个月内找到数据分析相关实习",
};

export interface Persisted {
  step: number;
  started: boolean;
  profile: Profile;
  selectedJobId: string;
  /** 旧版打卡存档遗留字段（已弃用打卡）；读取时一次性并入 knownSkillIds */
  doneSkills?: string[];
}

export interface PlanRecord {
  id: string;
  /** 用户给记录起的名字（可选）；为空时展示「专业 · 岗位」的默认名 */
  name?: string;
  createdAt: number;
  major: string;
  jobTitle: string;
  summary: string;
  markdown: string;
}

/* 服务端持久化（SQLite 为主，localStorage 仅作网络异常兜底） */
export interface ProfileRowFront {
  id: string;
  name: string;
  step: number;
  started: boolean;
  profile: any;
  selectedJobId: string;
  doneSkills: string[];
  updatedAt: string;
}

/* 我的 JD 库（真实岗位收藏，来源 career.db user_jds） */
export interface JdFront {
  id: string;
  title: string;
  raw: string;
  skills: string[];
  createdAt: number;
}

/** 简短的时间格式 */
export function fmtWeeks(w: number): string {
  if (w <= 0) return "已达成";
  if (w < 1) return "不到 1 周";
  if (w < 8) return `约 ${Math.round(w)} 周`;
  return `约 ${(w / 4.3).toFixed(1)} 个月`;
}
