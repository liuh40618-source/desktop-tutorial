/**
 * 能力翻译第二层：规则近似兜底（纯函数、零网络、零 LLM）
 *
 * 设计说明 4.1 第二层原为「LLM 兜底」，本轮（零 LLM 硬约束）改写为规则近似：
 *   ① alias-group：别名扩展组（如 取数 / 拉数 / 查数 → sql）
 *   ② substring  ：**仅拉丁别名**，长度 ≥4 且词边界匹配（中文 substring 已移除，见下方说明）
 *   ③ fuzzy      ：拉丁词条长度 ≥6 且编辑距离 = 1 且首字母相同的单字符拼写错误
 *
 * 红线：
 *  - **只提候选，绝不自动勾选**（与第一层一致，由用户四态确认）。
 *  - **只返回库内 id**（本函数只遍历传入的 skills）。
 *  - 不含任何网络请求 / embedding / OCR。
 *  - **高精度、低召回**：宁可漏一个（用户手动补），不可错一个（候选卡被灌垃圾）。
 *    编辑距离 ≤2 对 3–4 个字母的拉丁词等于没有约束，故收紧为「长度 ≥6 且距离 = 1」。
 *  - `java` 与 `javascript` 不得互相 fuzzy 命中；`sql` 不得 fuzzy 命中 `nosql`。
 */

import { findSkillAliasOccurrences } from "./skill-matching.mjs";

/** 别名扩展组：canonical 必须是库内 skillId */
export const ALIAS_GROUPS = [
  { canonical: "sql", terms: ["取数", "拉数", "查数", "写sql", "sql查询"] },
  { canonical: "data-viz", terms: ["做图", "出图", "可视化", "图表", "看板"] },
  { canonical: "doc-writing", terms: ["写文档", "写方案", "写材料", "写报告", "撰写"] },
  { canonical: "structured-expression", terms: ["汇报", "讲清楚", "表达清楚"] },
  { canonical: "project-mgmt", terms: ["排期", "跟进度", "推进项目"] },
  { canonical: "data-clean", terms: ["洗数据", "清理数据", "数据清洗"] },
];

const SOURCE_RANK = { "alias-group": 3, substring: 2, fuzzy: 1 };
const ASCII_TOKEN = /[a-z0-9+#.]+/g;

/** @param {unknown} value @returns {string} */
function lower(value) {
  return String(value ?? "").toLowerCase();
}

/** @param {string} value @returns {boolean} */
function isLatin(value) {
  return /^[\x00-\x7f]+$/.test(value) && /[a-z0-9]/i.test(value);
}

/**
 * 编辑距离（Damerau / OSA：相邻字符换位记 1 次）。
 * 用 10 行内联实现，不值得引第三方库。
 * 换位记 1 是必要的：`javascirpt`、`javascrpit` 这类真实手误在纯 Levenshtein 下距离为 2，
 * 会被「距离 ≤1」漏掉。
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) d[i][0] = i;
  for (let j = 0; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/**
 * 规则近似兜底：返回候选技能（不自动勾选）。
 * @param {string} text 用户原话 / 简历文本
 * @param {{ id: string, name?: string, aliases?: string[] }[]} skills 库内技能
 * @returns {{ id: string, source: 'alias-group' | 'substring' | 'fuzzy', confidence: 'high' | 'medium' | 'low', matchedText: string }[]}
 */
export function findSkillFallback(text, skills) {
  const source = typeof text === "string" ? text : "";
  const list = Array.isArray(skills) ? skills : [];
  const haystack = lower(source);
  if (!haystack || list.length === 0) return [];

  const byId = new Map(list.filter((s) => s && s.id).map((s) => [s.id, s]));
  // 已知词条（全部技能的别名）：fuzzy 不得把某个「已知词条」重新解释成另一个技能的拼写错误
  // （否则 openapi → openai、java → javascript 这类会跨技能误命中）
  const knownAliases = new Set();
  for (const skill of list) {
    for (const alias of Array.isArray(skill?.aliases) ? skill.aliases : []) {
      const needle = lower(alias);
      if (needle) knownAliases.add(needle);
    }
  }
  /** @type {Map<string, {id:string,source:string,confidence:string,matchedText:string}>} */
  const best = new Map();
  const consider = (id, src, confidence, matchedText) => {
    if (!id || !byId.has(id)) return;
    const prev = best.get(id);
    if (prev && SOURCE_RANK[prev.source] >= SOURCE_RANK[src]) return;
    best.set(id, { id, source: src, confidence, matchedText: String(matchedText ?? "") });
  };

  // ① 别名扩展组
  for (const group of ALIAS_GROUPS) {
    for (const term of group.terms) {
      const needle = lower(term);
      if (needle.length >= 2 && haystack.includes(needle)) {
        consider(group.canonical, "alias-group", "high", term);
      }
    }
  }

  // ② 子串包含：**中文 substring 已移除**。
  //    实测证据（真实语料）：「数学建模」「课程设计」「实验室」「网络排查」等，
  //    第一层 `findSkillAliasOccurrences` 已能命中「中文别名出现在长词中间」（中文无词边界），
  //    第二层再做中文 substring 属**纯冗余**且大量误报（建模⊂数学建模 → db-design、设计⊂课程设计 → prototype），
  //    6 句真实语料中「仅第二层 substring 才命中」= 0 条。
  //    拉丁别名保留，但要求**长度 ≥4 且词边界匹配**（复用第一层的边界实现，避免两份规则）。
  for (const skill of list) {
    if (!skill || !skill.id) continue;
    const candidates = [skill.name, ...(Array.isArray(skill.aliases) ? skill.aliases : [])];
    for (const alias of candidates) {
      const needle = lower(alias);
      if (!needle) continue;
      if (!isLatin(needle)) continue; // 中文 substring 已移除
      if (needle.length < 4) continue; // 拉丁别名 ≥4
      const boundaryHit = findSkillAliasOccurrences(source, alias).some((o) => !o.negated && !o.uncertain);
      if (boundaryHit) consider(skill.id, "substring", "medium", alias);
    }
  }

  // ③ fuzzy：仅拉丁词条，**长度 ≥6 且编辑距离 = 1 且首字母相同**。
  //    编辑距离 ≤2 对 3–4 个字母的拉丁词等于没有约束（QA 实测 74/109 技能会跨技能误命中）。
  //    第二层兜底的设计取向是**高精度、低召回**：宁可漏（用户手动补一下），不可错（候选卡被灌垃圾）。
  //    仍保留包含关系跳过，防止 java/javascript、sql/nosql 互命中。
  const tokens = haystack.match(ASCII_TOKEN) || [];
  for (const skill of list) {
    if (!skill || !skill.id) continue;
    const aliases = (Array.isArray(skill.aliases) ? skill.aliases : [])
      .map(lower)
      .filter((a) => isLatin(a) && a.length >= 6);
    if (!aliases.length) continue;
    for (const alias of aliases) {
      for (const token of tokens) {
        if (token.length < 6) continue;
        if (knownAliases.has(token)) continue; // 已知词条交给第一层，不做拼写近似
        if (alias === token) continue; // 完全相同属于第一层，不在此处
        if (token.includes(alias) || alias.includes(token)) continue; // 防 java/javascript、sql/nosql 互命中
        if (alias[0] !== token[0]) continue; // 首字母不同通常不是拼写近似（防 mysql↔nosql）
        if (levenshtein(alias, token) !== 1) continue; // 只认单字符拼写错误
        consider(skill.id, "fuzzy", "low", token);
      }
    }
  }

  // 按传入 skills 顺序返回，保证可复现
  const out = [];
  for (const skill of list) {
    if (!skill || !skill.id) continue;
    const hit = best.get(skill.id);
    if (hit) out.push({ ...hit });
  }
  return out;
}
