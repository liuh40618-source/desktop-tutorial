/**
 * 验收评判「规则层」纯函数（零 LLM，P0-15/16/17）
 *
 * 设计说明 5.3 的四层设计在本轮改写为：
 *   ① 规则层：是否含必含要素 —— 正则 / 字符串检测 + 用户逐条自评
 *   ② LLM 层：改写为规则抽取（数字、链接、文件名）
 *   ③ 规则层：映射证据等级 —— 本文件的纯函数
 *   ④ 用户层：可逐条推翻 + 可申请复核 —— 由 UI 记录，本函数不参与
 *
 * 红线：
 *  - 等级 **5（岗位或实习）绝不由本函数给出**，只能用户自评，避免把个人作品拔高成岗位经验。
 *  - 缺 `type` → 用 `other` 的 requiredElements；不抛异常。
 */

export interface DeliverableInput {
  type: string;
  artifactTitle?: string;
  artifactLocation?: string;
  artifactNote?: string;
  /** 用户逐条自评：有 / 无 / 不确定；`presentable` 为额外项（成果是否可展示） */
  userElementChecks: Record<string, "yes" | "no" | "unsure">;
}

export interface EvaluationResult {
  /** 1–4（等级 5 不由本函数给出） */
  suggestedLevel: number;
  confirmedElements: string[];
  missingElements: string[];
  /** 规则检测命中的要素 + 原文片段（供「我看了你的什么」） */
  ruleHits: string[];
}

export interface DeliverableTypeDef {
  label?: string;
  requiredElements?: string[];
}

export type DeliverableTypes = Record<string, DeliverableTypeDef>;

/**
 * 规则层可机器检测项（PRD 4.7）。
 * `element` 必须与 deliverable-types.json 的 requiredElements 逐字一致。
 */
const DETECTORS: { element: string; re: RegExp }[] = [
  { element: "原始数据来源", re: /(数据来源|来源|https?:\/\/|\.(csv|xlsx|xls|json|sql|txt|md)\b)/i },
  { element: "处理前后数量对比", re: /\d+\s*(行|条|个|份|次|张)/ },
  { element: "问题分类与处理理由", re: /(分类|归类|处理理由|原因)/ },
  { element: "可复现步骤或脚本", re: /(可复现|复现|脚本|\.(py|sql|sh|ipynb|js|ts)\b)/i },
  { element: "输入样例", re: /(输入样例|示例输入|样例数据|输入示例|input)/i },
  { element: "运行说明", re: /(运行说明|运行|启动|安装|依赖|README)/i },
  { element: "异常处理", re: /(异常处理|异常|报错处理|容错|error handling)/i },
  { element: "至少 3 个边界测试", re: /(边界|异常|失败|错误)\s*(测试|用例|case)/i },
  { element: "数据来源与口径", re: /(口径|数据来源|指标定义|指标说明)/ },
  { element: "至少 3 个图表", re: /(图表|看板|dashboard|chart)/i },
  { element: "关键数字核对", re: /(核对|校验|对账|一致)/ },
  { element: "目标读者与目的", re: /(目标读者|读者|目的|受众)/ },
  { element: "结构化章节", re: /(章节|目录|结构)/ },
  { element: "口径或术语说明", re: /(术语|口径)/ },
  { element: "版本与日期", re: /(\d{4}[-/年]\d{1,2}|版本|version)/i },
  { element: "设计目标与约束", re: /(设计目标|约束|限制)/ },
  { element: "至少 2 版方案对比", re: /(方案对比|第?\s*2\s*版|两版|对比方案|v2)/i },
  { element: "设计说明或标注", re: /(设计说明|标注|规范)/ },
  { element: "README", re: /README/i },
  { element: "可读的提交历史", re: /(提交历史|commit|git log)/i },
  { element: "可复现运行步骤", re: /(运行步骤|启动步骤|复现|可复现)/i },
  { element: "核心流程可走通", re: /(核心流程|流程|走通|可用)/ },
  { element: "加载/空/错误三种状态", re: /(加载|空状态|错误状态|empty state)/i },
  { element: "可访问链接", re: /https?:\/\//i },
  { element: "背景与问题", re: /(背景|问题)/ },
  { element: "个人贡献", re: /(我(负责|做|完成|实现)|个人贡献|我的部分)/ },
  { element: "方法与过程", re: /(方法|过程|步骤)/ },
  { element: "结果与量化", re: /\d+\s*(%|％|倍|行|条|个|份|次|元|人)/ },
  { element: "反思", re: /(反思|复盘|改进)/ },
  { element: "字段说明", re: /(字段说明|字段定义|schema)/i },
  { element: "采集或清洗口径", re: /(采集|清洗|口径)/ },
  { element: "质量检查项", re: /(质量检查|质检|校验项)/ },
  { element: "许可与隐私说明", re: /(隐私|脱敏|许可|license|授权)/i },
  { element: "任务说明", re: /(任务说明|任务描述)/ },
  { element: "可复现步骤", re: /(可复现|复现|步骤)/ },
  { element: "结果记录", re: /(结果|记录)/ },
];

/** 取某交付物类型的必含要素；缺 type → 用 `other`；都不存在 → 空数组（不抛异常）。 */
export function requiredElementsFor(type: string, types: DeliverableTypes): string[] {
  const table = types && typeof types === "object" ? types : {};
  const key = typeof type === "string" && type.trim() ? type : "other";
  const def = table[key];
  if (def && Array.isArray(def.requiredElements)) return [...def.requiredElements];
  const fallback = table.other;
  if (fallback && Array.isArray(fallback.requiredElements)) return [...fallback.requiredElements];
  return [];
}

/**
 * 规则层评判：命中要素 + 用户自评 → 建议等级 1–4。
 * 等级映射：ratio===1 且 artifactLocation 非空 且 presentable==='yes' → 4；
 *           ratio>=0.6 → 3；artifactLocation 非空 → 2；否则 → 1。
 */
export function evaluateDeliverable(input: DeliverableInput, types: DeliverableTypes): EvaluationResult {
  const safeInput = (input || {}) as DeliverableInput;
  const required = requiredElementsFor(safeInput.type, types);
  const note = typeof safeInput.artifactNote === "string" ? safeInput.artifactNote : "";
  const checks =
    safeInput.userElementChecks && typeof safeInput.userElementChecks === "object"
      ? safeInput.userElementChecks
      : ({} as Record<string, "yes" | "no" | "unsure">);
  const location = typeof safeInput.artifactLocation === "string" ? safeInput.artifactLocation.trim() : "";

  const requiredSet = new Set(required);
  const ruleConfirmed = new Set<string>();
  const ruleHits: string[] = [];
  for (const detector of DETECTORS) {
    if (!requiredSet.has(detector.element)) continue;
    const match = note.match(detector.re);
    if (!match) continue;
    ruleConfirmed.add(detector.element);
    const fragment = String(match[0] || "").trim();
    const line = fragment ? `${detector.element}：${fragment}` : detector.element;
    if (!ruleHits.includes(line)) ruleHits.push(line);
  }

  const confirmedSet = new Set<string>();
  for (const element of required) {
    if (ruleConfirmed.has(element) || checks[element] === "yes") confirmedSet.add(element);
  }
  const confirmedElements = required.filter((element) => confirmedSet.has(element));
  const missingElements = required.filter((element) => !confirmedSet.has(element));

  const ratio = required.length ? confirmedElements.length / required.length : 0;
  let suggestedLevel: number;
  if (required.length > 0 && ratio === 1 && location && checks.presentable === "yes") suggestedLevel = 4;
  else if (ratio >= 0.6) suggestedLevel = 3;
  else if (location) suggestedLevel = 2;
  else suggestedLevel = 1;

  return { suggestedLevel, confirmedElements, missingElements, ruleHits };
}
