/**
 * 交付物模板解析（共享模块，架构 §7.2 主理人改进）
 *
 * 单一真源：`scripts/data/validate-data.mjs` 与（第 2 轮接线后的）`lib/matcher.ts`
 * 必须共用本模块，禁止内联复制解析逻辑。
 *
 * 四级解析（任一命中即返回，兜底永不为空）：
 *   ① skill.action（技能级覆盖，原值原样）
 *   ② byCategory[skill.category]（分类默认模板，`{skill}` 替换为技能名）
 *   ③ deliverable-types（按交付物类型用 label + requiredElements 合成）
 *   ④ 通用兜底
 *
 * 纯函数、零副作用、不抛异常。
 */

/** 通用兜底交付物（永不为空） */
const GENERIC_ACCEPTANCE =
  "说明任务、个人贡献和实现过程；附可复现步骤、结果截图及 3 条验收记录。";

/** @param {string} name */
function genericDeliverable(name) {
  return `一份展示「${name}」的最小作品`;
}

/**
 * 取某交付物类型的必含要素；类型不存在或结构非法 → 空数组（不抛异常）。
 * @param {string} deliverableType
 * @param {Record<string, { requiredElements?: string[] }>} [deliverableTypes]
 * @returns {string[]}
 */
export function requiredElementsFor(deliverableType, deliverableTypes) {
  const def = deliverableTypes ? deliverableTypes[deliverableType] : undefined;
  if (def && Array.isArray(def.requiredElements)) return [...def.requiredElements];
  return [];
}

/** @param {unknown} v @returns {boolean} */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * 解析一个技能的交付物与验收标准。
 * @param {{ id?: string, name?: string, category?: string, action?: { deliverableType?: string, deliverable?: string, acceptance?: string } }} skill
 * @param {Record<string, { deliverableType?: string, deliverable?: string, acceptance?: string }>} [byCategory]
 * @param {Record<string, { label?: string, requiredElements?: string[] }>} [deliverableTypes]
 * @returns {{ deliverable: string, acceptance: string, deliverableType: string, requiredElements: string[] }}
 */
export function resolveActionTemplate(skill, byCategory, deliverableTypes) {
  const safeSkill = skill || {};
  const name = nonEmptyString(safeSkill.name) ? safeSkill.name : safeSkill.id || "这项技能";
  const category = safeSkill.category;
  const action = safeSkill.action;
  const categoryTpl = byCategory && category ? byCategory[category] : undefined;

  // deliverableType 优先取技能级，其次分类模板，最后 'other'
  const deliverableType =
    (action && nonEmptyString(action.deliverableType) && action.deliverableType) ||
    (categoryTpl && nonEmptyString(categoryTpl.deliverableType) && categoryTpl.deliverableType) ||
    "other";
  const requiredElements = requiredElementsFor(deliverableType, deliverableTypes);

  // ① 技能级覆盖
  if (action && nonEmptyString(action.deliverable) && nonEmptyString(action.acceptance)) {
    return {
      deliverable: action.deliverable,
      acceptance: action.acceptance,
      deliverableType,
      requiredElements,
    };
  }

  // ② 分类默认模板（{skill} → 技能名）
  if (categoryTpl && nonEmptyString(categoryTpl.deliverable) && nonEmptyString(categoryTpl.acceptance)) {
    return {
      deliverable: categoryTpl.deliverable.replace(/\{skill\}/g, name),
      acceptance: categoryTpl.acceptance,
      deliverableType,
      requiredElements,
    };
  }

  // ③ 交付物类型兜底
  const typeDef = deliverableTypes ? deliverableTypes[deliverableType] : undefined;
  if (typeDef && nonEmptyString(typeDef.label)) {
    return {
      deliverable: `一份含「${name}」的${typeDef.label}`,
      acceptance: requiredElements.length
        ? `需包含：${requiredElements.join("、")}。`
        : GENERIC_ACCEPTANCE,
      deliverableType,
      requiredElements,
    };
  }

  // ④ 通用兜底：永不为空
  return {
    deliverable: genericDeliverable(name),
    acceptance: GENERIC_ACCEPTANCE,
    deliverableType,
    requiredElements,
  };
}
