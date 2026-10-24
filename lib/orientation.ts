/**
 * 开场定位：排除法纯函数（零副作用、零 LLM、不抛异常）
 *
 * 与 `lib/matcher.ts` 零依赖：orientation 结果只用于**过滤与排序**，绝不参与匹配分
 * （岗位排序使用 matcher 的技能余弦相似度；方向偏好只用于方向筛选与探索安排）。
 *
 * 真实数据约定（T02.5 已定稿）：
 *  - `jobs[].workTags` **只含内容 tag**；条件 tag 已全部移除。
 *  - 只有 `tier === 'core'` 的内容 tag 触发排除；`incidental` 永不触发排除。
 *  - 条件选项（contextOptions）**恒定不参与任何排除计算**，只原样回传供 UI 展示为「自我清单」。
 */
import type { CandidateLevel, OrientationCandidate, OrientationResult, WorkTag } from "./types";
import { levelFromScore } from "./candidate-level.mjs";

// 等级类型与阈值对外统一出口：`matcher.ts` 复用**同一套**标准，禁止再造第二套。
export type { CandidateLevel } from "./types";
export { CANDIDATE_LEVEL_THRESHOLDS, levelFromScore } from "./candidate-level.mjs";

/** 方向级排除阈值：该方向被排除岗位比例 ≥ 该值 → 整个方向标记「已排除」。待校准（Q5） */
export const TRACK_EXCLUDE_RATIO = 0.6;

export interface OrientationInput {
  /** 勾选的 contentOptions.id */
  contentOptionIds: string[];
  /** 勾选的 contextOptions.id（仅自我清单，不参与排除） */
  contextOptionIds: string[];
  /** 第 3 步「已有基础」勾选后映射出的库内 skillId */
  knownSkillIds: string[];
}

export interface OrientationOption {
  id: string;
  tag: string;
  label: string;
  reason: string;
}

export interface OrientationKB {
  /** 岗位需带 workTags；`core` 为可选（用于计算「已具备该方向必备技能」） */
  jobs: {
    id: string;
    title: string;
    track: string;
    workTags?: WorkTag[];
    core?: { s: string; w: number }[];
  }[];
  tracks: { id: string; name: string }[];
  contentOptions: OrientationOption[];
  contextOptions: OrientationOption[];
  starterSkills: { id: string; label: string; skillIds: string[] }[];
}

const LEVEL_RANK: Record<CandidateLevel, number> = { 高: 4, 中高: 3, 中: 2, 低: 1 };

/**
 * 候选方向等级纯函数（禁止百分比）。
 * score = 未被排除的核心内容 tag 匹配数 + 已具备的该方向必备技能数。
 * 边界：≥7 高 / ≥4 中高 / ≥2 中 / 否则 低（阈值来自 `lib/candidate-level.mjs`，与岗位匹配等级共用）。
 */
export function estimateCandidateLevel(unexcludedTagMatch: number, knownSkillWeightHits: number): CandidateLevel {
  const a = Number.isFinite(unexcludedTagMatch) ? Math.max(0, unexcludedTagMatch) : 0;
  const b = Number.isFinite(knownSkillWeightHits) ? Math.max(0, knownSkillWeightHits) : 0;
  return levelFromScore(a + b);
}

/**
 * skillId 白名单过滤（matcher 侧一次；API 侧另有校验）：
 * 去掉非字符串 / 空串 / 重复项 / 不在库内的 id。任何路径都不得把库外词条当作 skillId。
 */
export function filterKnownSkillIds(ids: string[], knownIds: Set<string>): string[] {
  const source = Array.isArray(ids) ? ids : [];
  const known = knownIds instanceof Set ? knownIds : new Set<string>();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of source) {
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    if (!known.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 计算开场定位结果；缺字段时返回安全默认，绝不抛异常。 */
export function computeOrientation(
  input: OrientationInput,
  kb: OrientationKB,
  now: number = Date.now()
): OrientationResult {
  const safeInput = (input || {}) as OrientationInput;
  const jobs = Array.isArray(kb?.jobs) ? kb.jobs : [];
  const tracks = Array.isArray(kb?.tracks) ? kb.tracks : [];
  const contentOptions = Array.isArray(kb?.contentOptions) ? kb.contentOptions : [];
  const contentOptionIds = Array.isArray(safeInput.contentOptionIds) ? safeInput.contentOptionIds : [];
  const contextOptionIds = Array.isArray(safeInput.contextOptionIds) ? safeInput.contextOptionIds : [];
  const knownSkillIds = Array.isArray(safeInput.knownSkillIds) ? safeInput.knownSkillIds : [];

  const optionById = new Map(contentOptions.map((o) => [o.id, o]));
  const tagLabel = new Map(contentOptions.map((o) => [o.tag, o.label]));

  // ① 勾选内容选项 → tag 集合（只有内容 tag 参与排除）
  const selectedContentTags = new Set<string>();
  for (const id of contentOptionIds) {
    const option = optionById.get(id);
    if (option) selectedContentTags.add(option.tag);
  }

  // ② 岗位级排除：仅内容 tag 的 core 行
  const excludedJobs: OrientationResult["excludedJobs"] = [];
  for (const job of jobs) {
    const hitTags: string[] = [];
    for (const t of job.workTags || []) {
      if (t.tier === "core" && selectedContentTags.has(t.tag) && !hitTags.includes(t.tag)) hitTags.push(t.tag);
    }
    if (hitTags.length) {
      excludedJobs.push({ jobId: job.id, title: job.title, trackId: job.track, tagIds: hitTags });
    }
  }
  const excludedJobIds = excludedJobs.map((j) => j.jobId);
  const excludedSet = new Set(excludedJobIds);

  // ③ 方向级聚合：ratio = 该方向被排除岗位数 / 该方向岗位总数
  const totalByTrack = new Map<string, number>();
  const excludedByTrack = new Map<string, number>();
  for (const job of jobs) {
    totalByTrack.set(job.track, (totalByTrack.get(job.track) || 0) + 1);
    if (excludedSet.has(job.id)) excludedByTrack.set(job.track, (excludedByTrack.get(job.track) || 0) + 1);
  }

  const excludedTrackIds: string[] = [];
  const partialTrackIds: string[] = [];
  const excludedReasons: OrientationResult["excludedReasons"] = [];
  for (const track of tracks) {
    const total = totalByTrack.get(track.id) || 0;
    if (total === 0) continue;
    const excludedCount = excludedByTrack.get(track.id) || 0;
    const ratio = excludedCount / total;
    if (ratio >= TRACK_EXCLUDE_RATIO) {
      excludedTrackIds.push(track.id);
      const tagIds = new Set<string>();
      let assumed = false;
      for (const job of jobs) {
        if (job.track !== track.id || !excludedSet.has(job.id)) continue;
        for (const t of job.workTags || []) {
          if (t.tier === "core" && selectedContentTags.has(t.tag)) {
            tagIds.add(t.tag);
            if (t.reviewStatus === "assumed") assumed = true;
          }
        }
      }
      const labels = [...tagIds].map((t) => tagLabel.get(t) || t).join("、");
      excludedReasons.push({
        trackId: track.id,
        trackName: track.name,
        reason: `该方向 ${excludedCount}/${total} 个岗位的核心工作是「${labels}」，你勾选排除了这类工作内容`,
        assumed,
      });
    } else if (ratio > 0) {
      partialTrackIds.push(track.id);
    }
  }
  const excludedTrackSet = new Set(excludedTrackIds);

  // ④ 候选方向：未被整体排除的方向，按等级排序取 Top 3
  const known = new Set(knownSkillIds.filter((x): x is string => typeof x === "string" && !!x));
  const rows: (OrientationCandidate & { score: number; order: number })[] = [];
  tracks.forEach((track, order) => {
    if (excludedTrackSet.has(track.id)) return;
    const trackJobs = jobs.filter((j) => j.track === track.id);
    if (!trackJobs.length) return;

    const unexcludedTags = new Set<string>();
    const skillHits = new Set<string>();
    for (const job of trackJobs) {
      for (const t of job.workTags || []) {
        if (t.tier === "core" && !selectedContentTags.has(t.tag)) unexcludedTags.add(t.tag);
      }
      for (const c of job.core || []) {
        if (c && known.has(c.s)) skillHits.add(c.s);
      }
    }

    const reasons: string[] = [];
    if (unexcludedTags.size) {
      const labels = [...unexcludedTags].map((t) => tagLabel.get(t) || t).join("、");
      reasons.push(`该方向有 ${unexcludedTags.size} 类你未排除的核心工作内容（${labels}）`);
    }
    if (skillHits.size) reasons.push(`你已有的 ${skillHits.size} 项技能是该方向岗位的必备技能`);
    if (!reasons.length) reasons.push("该方向与你的排除项不冲突，但暂无直接技能交集");

    rows.push({
      trackId: track.id,
      trackName: track.name,
      level: estimateCandidateLevel(unexcludedTags.size, skillHits.size),
      reasons,
      pending: [
        `该方向共 ${trackJobs.length} 个岗位，仅按核心工作内容初筛，未逐一核对`,
        "技能证据等级尚未评估（自评后可提高判断精度）",
      ],
      sampleJobIds: trackJobs.filter((j) => !excludedSet.has(j.id)).slice(0, 2).map((j) => j.id),
      score: unexcludedTags.size + skillHits.size,
      order,
    });
  });
  rows.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.score - a.score || a.order - b.order);
  const candidates: OrientationCandidate[] = rows.slice(0, 3).map((r) => ({
    trackId: r.trackId,
    trackName: r.trackName,
    level: r.level,
    reasons: r.reasons,
    pending: r.pending,
    sampleJobIds: r.sampleJobIds,
  }));

  return {
    contentExcluded: [...new Set(contentOptionIds)],
    contextExcluded: [...new Set(contextOptionIds)],
    excludedJobIds,
    excludedJobs,
    excludedTrackIds,
    partialTrackIds,
    candidates,
    excludedReasons,
    // 条件选项恒定不参与排除（知识库暂无工作条件数据），原「候选<3 才降级」语义作废
    contextExclusionApplied: false,
    skipped: false,
    completedAt: now,
  };
}
