/**
 * confidence 推导（共享模块，架构 §7.2 主理人改进）
 *
 * 单一真源：`validate-data.mjs` 与 `lib/db.ts`（后台表单）必须共用本模块，
 * 禁止内联复制，否则「脚本说 PASS、应用却跑不对」将永远无法被发现。
 *
 * 定义（PRD P0-26，写死）：
 *   sample_size >= 15 → 'high'（且需经人工确认；本函数只做样本量映射）
 *   5 <= sample_size < 15 → 'medium'
 *   sample_size < 5 → 'low'
 * 非法 / 缺失输入 → 'low'（保守，不假装可信）。
 */

/** @param {number} n 样本量（基于几份 JD / 几个岗位）
 *  @returns {'high'|'medium'|'low'} */
export function confidenceForSampleSize(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "low";
  if (n >= 15) return "high";
  if (n >= 5) return "medium";
  return "low";
}
