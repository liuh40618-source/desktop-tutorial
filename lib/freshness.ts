/**
 * 知识库时效纯函数（P0-19，架构 §3.3）
 *
 * 设计约束：
 * 1. 纯函数、零副作用，**不得抛异常** —— 非法 / 缺失输入一律返回安全默认。
 * 2. 前端所有时效文案必须来自本模块，禁止任何硬编码时效字符串。
 * 3. 宁可保守（判为「已过时」），也不假装数据新鲜。
 */

export type Freshness = "fresh" | "referenceable" | "needs_review" | "outdated";

/** 四档时效的中文档位名，供 UI 直接使用 */
export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: "近期复核",
  referenceable: "可参考",
  needs_review: "建议复核",
  outdated: "已过时",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** <90d fresh */
const DAYS_REFERENCEABLE = 90;
/** <180d referenceable */
const DAYS_NEEDS_REVIEW = 180;
/** <365d needs_review；≥365d outdated */
const DAYS_OUTDATED = 365;

/**
 * 把「最后人工复核时间」解析为毫秒时间戳。
 * 非法 / 缺失输入返回 null（不抛异常）。
 */
function parseVerifiedAt(verifiedAt: string | null | undefined): number | null {
  if (typeof verifiedAt !== "string") return null;
  const trimmed = verifiedAt.trim();
  if (!trimmed) return null;
  const ts = Date.parse(trimmed);
  return Number.isNaN(ts) ? null : ts;
}

/** 计算已过去的天数；now 非法时退化为当前时间，避免抛异常 */
function elapsedDays(verifiedTs: number, now?: Date): number {
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now();
  return (nowMs - verifiedTs) / MS_PER_DAY;
}

/**
 * 时效档位：
 *   <90d  → 'fresh'
 *   <180d → 'referenceable'
 *   <365d → 'needs_review'
 *   ≥365d → 'outdated'
 * verifiedAt 为 null 或非法 → 'outdated'。
 */
export function getFreshness(verifiedAt: string | null | undefined, now?: Date): Freshness {
  const ts = parseVerifiedAt(verifiedAt);
  if (ts === null) return "outdated";
  const days = elapsedDays(ts, now);
  if (days < DAYS_REFERENCEABLE) return "fresh";
  if (days < DAYS_NEEDS_REVIEW) return "referenceable";
  if (days < DAYS_OUTDATED) return "needs_review";
  return "outdated";
}

/**
 * 时效展示文案：
 *   <1d    → 「今天复核」
 *   <30d   → 「N 天前复核」
 *   <365d  → 「N 个月前复核」
 *   ≥365d  → 「YYYY-MM-DD 复核」
 * verifiedAt 为 null 或非法 → 「复核时间未知」。
 */
export function formatVerifiedAt(verifiedAt: string | null | undefined, now?: Date): string {
  const ts = parseVerifiedAt(verifiedAt);
  if (ts === null) return "复核时间未知";
  const days = elapsedDays(ts, now);
  if (days < 1) return "今天复核";
  if (days < 30) return `${Math.floor(days)} 天前复核`;
  if (days < DAYS_OUTDATED) return `${Math.floor(days / 30)} 个月前复核`;
  return `${formatDate(ts)} 复核`;
}

/** 把时间戳格式化为 YYYY-MM-DD（本地时区） */
function formatDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
