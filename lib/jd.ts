/**
 * 真实 JD 的本地文本清洗与技能规则识别。
 *
 * 这是第一阶段的可解释基线：不调用模型，只返回命中的技能、别名证据和
 * 清洗后的文本。后续语义相似度/分类模型可以复用同一份结果契约。
 */

import { findSkillAliasOccurrences } from "./skill-matching.mjs";

export const MAX_JD_CHARS = 20000;
export const MAX_JD_TITLE_CHARS = 120;

export interface JdSkillSource {
  id: string;
  name: string;
  matchedAliases: string[];
  negatedAliases: string[];
  uncertainAliases: string[];
  method: "rule";
}

export interface ParsedJdText {
  raw: string;
  normalized: string;
  skills: string[];
  skillSources: JdSkillSource[];
  truncated: boolean;
}

interface SkillForDetection {
  id: string;
  name: string;
  aliases?: string[];
}

function isNoiseLine(line: string): boolean {
  if (!line.trim()) return true;
  if (/^(职位描述|岗位职责|任职要求|岗位要求|福利待遇|公司简介|job description|requirements?)\s*[:：]?$/i.test(line)) {
    return true;
  }
  if (/^[-_=·•*\s]+$/.test(line)) return true;
  return false;
}

/** 清理 JD 中常见的复制粘贴噪声，但保留技能词和原始换行语义。 */
export function normalizeJdText(input: string): { text: string; truncated: boolean } {
  const source = String(input ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\bhttps?:\/\//gi, "")
    .replace(/\bwww\./gi, "");

  const text = source
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]{2,}/g, " "))
    .filter((line) => !isNoiseLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text: text.slice(0, MAX_JD_CHARS),
    truncated: text.length > MAX_JD_CHARS,
  };
}

export function parseJdText(input: string, skills: SkillForDetection[]): ParsedJdText {
  const { text: normalized, truncated } = normalizeJdText(input);
  const skillSources: JdSkillSource[] = [];

  for (const skill of skills) {
    const aliases: string[] = [];
    const seenAliases = new Set<string>();
    for (const value of [skill.name, ...(Array.isArray(skill.aliases) ? skill.aliases : [])]) {
      const alias = String(value).trim();
      const key = alias.toLowerCase();
      if (alias && !seenAliases.has(key)) {
        seenAliases.add(key);
        aliases.push(alias);
      }
    }
    const matches = aliases
      .map((alias) => ({ alias, occurrences: findSkillAliasOccurrences(normalized, alias) }))
      .filter((item) => item.occurrences.length > 0);
    const matchedAliases = matches.map((item) => item.alias);
    const negatedAliases = matches
      .filter((item) => item.occurrences.every((occurrence) => occurrence.negated))
      .map((item) => item.alias);
    const uncertainAliases = matches
      .filter((item) => item.occurrences.every((occurrence) => occurrence.uncertain))
      .map((item) => item.alias);
    if (matchedAliases.length) {
      skillSources.push({
        id: skill.id,
        name: skill.name,
        matchedAliases,
        negatedAliases,
        uncertainAliases,
        method: "rule",
      });
    }
  }

  return {
    raw: String(input ?? ""),
    normalized,
    skills: skillSources.map((source) => source.id),
    skillSources,
    truncated,
  };
}
