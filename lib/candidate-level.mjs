/**
 * 等级阈值与映射（全产品唯一真源，架构 §7.2 同款共享模块做法）
 *
 * 为什么独立成 .mjs：`lib/orientation.ts`（开场定位）与 `lib/matcher.ts`（岗位匹配）都必须
 * 共用**同一套**「高/中高/中/低」阈值。共享模块是唯一能让两端真正一致、且被 Node 原生
 * TS 直跑（--experimental-strip-types）与 tsc 同时解析的做法，避免「同一份设计说明两套标准」。
 *
 * 约束：纯函数、零依赖、零副作用，**不得抛异常**；非法 / 负数输入按 0 处理。
 */

/** 等级阈值（0–10 量级）：≥7 高 / ≥4 中高 / ≥2 中 / 否则 低 */
export const CANDIDATE_LEVEL_THRESHOLDS = { high: 7, midHigh: 4, mid: 2 };

/**
 * 分数（0–10 量级）→ 高 / 中高 / 中 / 低。
 * 边界：≥7 高 / ≥4 中高 / ≥2 中 / 否则 低。
 * @param {number} score
 * @returns {'高'|'中高'|'中'|'低'}
 */
export function levelFromScore(score) {
  const s = Number.isFinite(score) ? Math.max(0, score) : 0;
  if (s >= CANDIDATE_LEVEL_THRESHOLDS.high) return "高";
  if (s >= CANDIDATE_LEVEL_THRESHOLDS.midHigh) return "中高";
  if (s >= CANDIDATE_LEVEL_THRESHOLDS.mid) return "中";
  return "低";
}
