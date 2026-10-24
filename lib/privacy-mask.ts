/**
 * 浏览器与服务端共用的本地脱敏规则。
 *
 * 这不是“匿名化证明”：它只覆盖常见格式，并且始终把最终文本交给用户编辑确认。
 * 规则保持纯函数、零网络、零第三方依赖，方便在上传简历后的浏览器侧立即运行。
 */

export interface MaskHit {
  type: "phone" | "email" | "id-card" | "bank-card" | "manual";
  original: string;
  replacement: string;
}

export interface MaskResult {
  text: string;
  hits: MaskHit[];
}

const AUTO_RULES: Array<{ type: MaskHit["type"]; pattern: RegExp; replacement: string }> = [
  { type: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[邮箱已隐藏]" },
  { type: "phone", pattern: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, replacement: "[手机号已隐藏]" },
  { type: "id-card", pattern: /(?<![\dXx])\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dXx])/g, replacement: "[证件号已隐藏]" },
  { type: "bank-card", pattern: /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g, replacement: "[卡号已隐藏]" },
];

const MAX_MANUAL_TERM_LENGTH = 80;
const MAX_MANUAL_TERMS = 30;

function cleanControlChars(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function normalizeManualTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const term of terms.slice(0, MAX_MANUAL_TERMS)) {
    const value = cleanControlChars(String(term ?? "")).trim();
    if (!value || value.length > MAX_MANUAL_TERM_LENGTH || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

/** 自动规则 + 手动词条遮盖。手动词条按字面处理，不拼接成正则，避免正则注入。 */
export function maskText(input: string, manualTerms: string[] = []): MaskResult {
  let text = cleanControlChars(String(input ?? "")).slice(0, 20000);
  const hits: MaskHit[] = [];
  for (const rule of AUTO_RULES) {
    text = text.replace(rule.pattern, (original) => {
      hits.push({ type: rule.type, original, replacement: rule.replacement });
      return rule.replacement;
    });
  }
  for (const term of normalizeManualTerms(manualTerms)) {
    if (!text.includes(term)) continue;
    const replacement = "[手动隐藏]";
    text = text.split(term).join(replacement);
    hits.push({ type: "manual", original: term, replacement });
  }
  return { text, hits };
}

/** 写入画像、送入匹配器或发送到审计接口前的最后一道文本清洗。 */
export function strictCleanText(input: string): string {
  return cleanControlChars(String(input ?? ""))
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 20000);
}

export function maskLabel(type: MaskHit["type"]): string {
  return ({
    phone: "手机号",
    email: "邮箱",
    "id-card": "证件号",
    "bank-card": "卡号",
    manual: "手动词条",
  } as const)[type];
}
