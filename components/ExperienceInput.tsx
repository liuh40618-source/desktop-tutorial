"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, FileText, Play, Sparkles } from "lucide-react";
import type { Profile } from "@/lib/types";
import { maskText, strictCleanText } from "@/lib/privacy-mask";
import { PrivacyMaskBoard } from "@/components/PrivacyMaskBoard";

type Parts = NonNullable<Profile["experienceParts"]>;
const MERGE_KEYS: (keyof Parts)[] = ["what", "part", "tools", "problem", "result"];
const EXP_FIELDS: { key: keyof Parts; label: string; hint: string }[] = [
  { key: "what", label: "你做过什么？", hint: "例如：为社团办了一次问卷调研" },
  { key: "part", label: "你负责哪个部分？", hint: "例如：我负责回收并整理全部问卷" },
  { key: "tools", label: "用了什么工具或方法？", hint: "例如：Excel、剔除无效答卷、分类统计" },
  { key: "problem", label: "解决了什么问题？", hint: "例如：答卷质量参差，数据难以汇总" },
  { key: "result", label: "做出了什么结果？", hint: "例如：整理出 328 份有效问卷，输出分类统计和 3 张图表" },
];
const PART_TAGS: { value: string; label: string }[] = [
  { value: "data", label: "数据整理与统计" }, { value: "code", label: "写代码 / 做功能" },
  { value: "design", label: "视觉 / 交互设计" }, { value: "writing", label: "写文档 / 写文案" },
  { value: "coordination", label: "协调与推进" }, { value: "research", label: "调研与分析" },
  { value: "operation", label: "运营执行" }, { value: "other", label: "其他（自由填写）" },
];
const EXPERIENCE_TYPES: { value: NonNullable<Profile["experienceType"]>; label: string }[] = [
  { value: "course", label: "课程项目" }, { value: "competition", label: "竞赛" }, { value: "club", label: "社团" },
  { value: "internship", label: "实习" }, { value: "parttime", label: "兼职" }, { value: "personal", label: "个人作品" }, { value: "none", label: "无" },
];
function nowMs(): number { return Date.now(); }

export function ExperienceInput({ profile, setProfile, onNext, onEmptyCheck, onDemo, onResume, onTrial, onBrowseJobs }: {
  profile: Profile; setProfile: (p: Profile) => void; onNext: () => void; onEmptyCheck?: () => void; onDemo?: () => void; onResume?: () => void; onTrial?: () => void; onBrowseJobs?: () => void;
}) {
  const [manualTerms, setManualTerms] = useState<string[]>(profile.experienceMasking?.manualTerms ?? []);
  const [parts, setParts] = useState<Parts>(() => ({
    title: profile.experienceParts?.title ?? "", what: profile.experienceParts?.what ?? (profile.experienceParts ? "" : profile.experiences),
    part: profile.experienceParts?.part ?? "", partTags: profile.experienceParts?.partTags ?? [], tools: profile.experienceParts?.tools ?? "",
    problem: profile.experienceParts?.problem ?? "", result: profile.experienceParts?.result ?? "", hasDeliverable: profile.experienceParts?.hasDeliverable, deliverableNote: profile.experienceParts?.deliverableNote ?? "",
  }));
  function patchParts(change: Partial<Parts>) {
    const next: Parts = { ...parts, ...change }; setParts(next);
    const cleanString = (value: unknown) => strictCleanText(maskText(String(value ?? ""), manualTerms).text);
    const cleanParts: Parts = { ...next, title: cleanString(next.title), what: cleanString(next.what), part: cleanString(next.part), partTagsOther: cleanString(next.partTagsOther), tools: cleanString(next.tools), problem: cleanString(next.problem), result: cleanString(next.result), deliverableNote: cleanString(next.deliverableNote) };
    const merged = MERGE_KEYS.map((k) => String(cleanParts[k] ?? "")).filter(Boolean).join("\n");
    setProfile({ ...profile, experienceParts: cleanParts, experiences: merged, experienceMasking: { version: "regex-v1", manualTerms, autoMaskedCount: MERGE_KEYS.reduce((sum, key) => sum + maskText(String(next[key] ?? ""), manualTerms).hits.filter((hit) => hit.type !== "manual").length, 0), cleanedText: merged, cleanedAt: nowMs() } });
  }
  function patchCleaned(cleaned: string, terms: string[]) {
    setManualTerms(terms); const cleanedSafe = strictCleanText(maskText(cleaned, terms).text);
    setProfile({ ...profile, experiences: cleanedSafe, experienceMasking: { version: "regex-v1", manualTerms: terms, autoMaskedCount: maskText(rawExperience, terms).hits.filter((hit) => hit.type !== "manual").length, cleanedText: cleanedSafe, cleanedAt: nowMs() } });
  }
  function togglePartTag(value: string) { const current = parts.partTags ?? []; patchParts({ partTags: current.includes(value) ? current.filter((x) => x !== value) : [...current, value] }); }
  const rawExperience = MERGE_KEYS.map((k) => String(parts[k] ?? "")).filter(Boolean).join("\n");
  const filled = MERGE_KEYS.some((k) => String(parts[k] ?? "").trim().length > 0);
  const appendPrompt = (text: string) => patchParts({ what: `${parts.what ?? ""}${parts.what ? "\n" : ""}${text}` });

  return <section className="experience-page">
    <div className="chapter-heading experience-hero"><div><span className="chapter-label">01 / 讲一件你做过的事</span><h1>先讲故事，再整理成证据。</h1><p className="experience-lead">不用先填专业、技能或岗位。把一件真实经历讲给我听，系统只会帮你找出做了什么、留下了什么，最后由你确认哪些算能力。</p></div>{onDemo && <button className="quiet-button" onClick={onDemo}><Play size={16} />试一段示例</button>}</div>
    <form onSubmit={(event) => { event.preventDefault(); onNext(); }}>
      <div className="experience-story-card">
        <div className="experience-story-kicker"><Sparkles size={15} />从一句话开始</div>
        <label className="experience-story-label" htmlFor="exp-story">讲一件你亲手做过的事</label>
        <textarea id="exp-story" className="experience-story-input" value={String(parts.what ?? "")} maxLength={4000} rows={7} placeholder="例如：我为社团做了一次问卷调研，负责回收和整理数据，用 Excel 做了分类统计，最后给小组做了 3 张图表。" onChange={(event) => patchParts({ what: event.target.value })} />
        <div className="experience-prompt-row" aria-label="写作提示"><span>可以顺手说说：</span><button type="button" onClick={() => appendPrompt("我负责了……")}>我负责了什么</button><button type="button" onClick={() => appendPrompt("我留下了……")}>我留下了什么</button><button type="button" onClick={() => appendPrompt("最卡的是……")}>最卡的是哪一步</button></div>
        <label className="experience-title-inline" htmlFor="exp-title"><span>给这件事起个名字（选填）</span><input id="exp-title" value={parts.title ?? ""} maxLength={200} placeholder="例如：社团问卷调研" onChange={(event) => patchParts({ title: event.target.value })} /></label>
      </div>
      <details className="experience-refine-card"><summary><span><ChevronDown size={16} />想得更清楚一点？再补几句</span><small>选填，不影响先继续</small></summary><div className="experience-refine-grid">{EXP_FIELDS.filter((f) => f.key !== "what").map((f) => <label key={f.key} className="exp-field" htmlFor={`exp-${f.key}`}><span className="exp-field-label"><FileText size={15} />{f.label}</span><textarea id={`exp-${f.key}`} className="exp-field-input" value={String(parts[f.key] ?? "")} maxLength={4000} rows={3} placeholder={f.hint} onChange={(event) => patchParts({ [f.key]: event.target.value } as Partial<Parts>)} /></label>)}</div><fieldset className="exp-field"><legend className="exp-field-label">你负责的部分（可多选）</legend><div className="mt-1 flex flex-wrap gap-2">{PART_TAGS.map((tag) => { const on = (parts.partTags ?? []).includes(tag.value); return <button key={tag.value} type="button" aria-pressed={on} onClick={() => togglePartTag(tag.value)} className={`chip-btn ${on ? "on" : ""}`}>{tag.label}</button>; })}</div>{(parts.partTags ?? []).includes("other") && <textarea className="exp-field-input mt-2" value={parts.partTagsOther ?? ""} maxLength={200} rows={2} placeholder="补充说明：你还负责了什么？" onChange={(event) => patchParts({ partTagsOther: event.target.value })} />}</fieldset><fieldset className="exp-field"><legend className="exp-field-label">这段经历有交付物吗？</legend><div className="mt-1 flex flex-wrap gap-2">{([['yes', '有'], ['no', '没有'], ['unsure', '不确定']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={parts.hasDeliverable === value} onClick={() => patchParts({ hasDeliverable: parts.hasDeliverable === value ? undefined : value })} className={`chip-btn ${parts.hasDeliverable === value ? "on" : ""}`}>{label}</button>)}</div>{parts.hasDeliverable === "yes" && <textarea className="exp-field-input mt-2" value={parts.deliverableNote ?? ""} maxLength={500} rows={2} placeholder="交付物是什么？例如：一份分析报告 / 一个可打开的网页" onChange={(event) => patchParts({ deliverableNote: event.target.value })} />}</fieldset></details>
      <details className="experience-context-disclosure"><summary><ChevronDown size={15} />补充背景（专业、年级、时间）</summary><div className="experience-context"><label>专业 <input placeholder="选填" value={profile.major} onChange={(event) => setProfile({ ...profile, major: event.target.value })} /></label><label>年级 <input placeholder="选填" value={profile.grade} onChange={(event) => setProfile({ ...profile, grade: event.target.value })} /></label><label>经历类型<select value={profile.experienceType ?? ""} onChange={(event) => setProfile({ ...profile, experienceType: (event.target.value || undefined) as Profile["experienceType"] })}><option value="">不填</option>{EXPERIENCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label><label>发生时间 <input placeholder="例如：2025 秋（选填）" value={profile.experienceTimeline ?? ""} onChange={(event) => setProfile({ ...profile, experienceTimeline: event.target.value })} /></label></div></details>
      <PrivacyMaskBoard value={rawExperience} initialManualTerms={manualTerms} initialCleaned={profile.experienceMasking?.cleanedText} onChange={patchCleaned} />
      <div className="experience-bottom"><p>只建议、不夸大。它算不算能力，由你确认。<br />请勿包含姓名、电话等个人信息。</p><button className="btn btn-primary" disabled={!filled}>记好了，去核对能力 <ArrowRight size={18} /></button></div>
    </form>
    <div className="entry-alternatives"><button className="btn btn-secondary" onClick={onEmptyCheck ?? onNext}>直接核对能力 <ArrowRight size={16} /></button>{onTrial && <button className="quiet-button" onClick={onTrial}>没方向？先做一项 15 分钟职业试驾 <ArrowRight size={15} /></button>}{onBrowseJobs && <button className="quiet-button" onClick={onBrowseJobs}>我已有目标岗位或 JD <ArrowRight size={15} /></button>}{onResume && <button className="quiet-button" onClick={onResume}>继续上次的试选 <ArrowRight size={15} /></button>}</div>
  </section>;
}
