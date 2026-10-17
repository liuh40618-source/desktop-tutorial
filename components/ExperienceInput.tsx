"use client";

import { useState } from "react";
import { ArrowRight, FileText, Play } from "lucide-react";
import type { Profile } from "@/lib/types";

type Parts = NonNullable<Profile["experienceParts"]>;

/** 合并成 experiences 的字段与顺序——**必须保持不变**，detectSkills 的输入不能受影响 */
const MERGE_KEYS: (keyof Parts)[] = ["what", "part", "tools", "problem", "result"];

const EXP_FIELDS: { key: keyof Parts; label: string; hint: string }[] = [
  { key: "what", label: "你做过什么？", hint: "例如：为社团办了一次问卷调研" },
  { key: "part", label: "你负责哪个部分？", hint: "例如：我负责回收并整理全部问卷" },
  { key: "tools", label: "用了什么工具或方法？", hint: "例如：Excel、剔除无效答卷、分类统计" },
  { key: "problem", label: "解决了什么问题？", hint: "例如：答卷质量参差，数据难以汇总" },
  { key: "result", label: "做出了什么结果？", hint: "例如：整理出 328 份有效问卷，输出分类统计和 3 张图表" },
];

/** PRD 4.5 partTags：负责部分多选（只作结构化记录，不进入技能识别文本） */
const PART_TAGS: { value: string; label: string }[] = [
  { value: "data", label: "数据整理与统计" },
  { value: "code", label: "写代码 / 做功能" },
  { value: "design", label: "视觉 / 交互设计" },
  { value: "writing", label: "写文档 / 写文案" },
  { value: "coordination", label: "协调与推进" },
  { value: "research", label: "调研与分析" },
  { value: "operation", label: "运营执行" },
  { value: "other", label: "其他（自由填写）" },
];

const EXPERIENCE_TYPES: { value: NonNullable<Profile["experienceType"]>; label: string }[] = [
  { value: "course", label: "课程项目" },
  { value: "competition", label: "竞赛" },
  { value: "club", label: "社团" },
  { value: "internship", label: "实习" },
  { value: "parttime", label: "兼职" },
  { value: "personal", label: "个人作品" },
  { value: "none", label: "无" },
];

export function ExperienceInput({ profile, setProfile, onNext, onEmptyCheck, onDemo, onResume, onTrial, onBrowseJobs }: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  onNext: () => void;
  onEmptyCheck?: () => void;
  onDemo?: () => void;
  onResume?: () => void;
  onTrial?: () => void;
  onBrowseJobs?: () => void;
}) {
  const [parts, setParts] = useState<Parts>(() => ({
    title: profile.experienceParts?.title ?? "",
    what: profile.experienceParts?.what ?? (profile.experienceParts ? "" : profile.experiences),
    part: profile.experienceParts?.part ?? "",
    partTags: profile.experienceParts?.partTags ?? [],
    tools: profile.experienceParts?.tools ?? "",
    problem: profile.experienceParts?.problem ?? "",
    result: profile.experienceParts?.result ?? "",
    hasDeliverable: profile.experienceParts?.hasDeliverable,
    deliverableNote: profile.experienceParts?.deliverableNote ?? "",
  }));

  /**
   * 统一写入：**新增字段（title/partTags/hasDeliverable/deliverableNote）不参与合并文本**，
   * 避免把勾选项当成用户原话，违反「命中原文」原则。
   */
  function patchParts(change: Partial<Parts>) {
    const next: Parts = { ...parts, ...change };
    setParts(next);
    setProfile({
      ...profile,
      experienceParts: next,
      experiences: MERGE_KEYS.map((k) => String(next[k] ?? "")).filter(Boolean).join("\n"),
    });
  }

  function togglePartTag(value: string) {
    const current = parts.partTags ?? [];
    patchParts({
      partTags: current.includes(value) ? current.filter((x) => x !== value) : [...current, value],
    });
  }

  const filled = MERGE_KEYS.some((k) => String(parts[k] ?? "").trim().length > 0);

  return <section className="experience-page">
    <div className="chapter-heading"><div><span className="chapter-label">01 / 如实记录你的经历</span><h1>把做过的事，说具体。</h1><p className="experience-lead">先如实写下事实，写具体、写到能对得上“我负责什么、用了什么、结果如何”。它算不算能力、怎么写进简历，在下一步和你一起核对——系统只建议，不替你去夸。</p></div>{onDemo && <button className="quiet-button" onClick={onDemo}><Play size={16} />试一段示例</button>}</div>
    <form onSubmit={(event) => { event.preventDefault(); onNext(); }}>
      <div className="experience-paper exp-structured">
        <label className="exp-field" htmlFor="exp-title">
          <span className="exp-field-label"><FileText size={15} />这段经历叫什么？（选填）</span>
          <textarea
            id="exp-title"
            className="exp-field-input"
            value={parts.title ?? ""}
            maxLength={200}
            rows={1}
            placeholder="例如：社团问卷调研"
            onChange={(event) => patchParts({ title: event.target.value })}
          />
        </label>
        {EXP_FIELDS.map((f) => (
          <label key={f.key} className="exp-field" htmlFor={`exp-${f.key}`}>
            <span className="exp-field-label"><FileText size={15} />{f.label}</span>
            <textarea
              id={`exp-${f.key}`}
              className="exp-field-input"
              value={String(parts[f.key] ?? "")}
              maxLength={4000}
              rows={f.key === "what" ? 2 : 1}
              placeholder={f.hint}
              onChange={(event) => patchParts({ [f.key]: event.target.value } as Partial<Parts>)}
            />
          </label>
        ))}

        <fieldset className="exp-field">
          <legend className="exp-field-label">你负责的部分（多选，选填）</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {PART_TAGS.map((tag) => {
              const on = (parts.partTags ?? []).includes(tag.value);
              return (
                <button
                  key={tag.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => togglePartTag(tag.value)}
                  className={`chip-btn ${on ? "on" : ""}`}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
          {(parts.partTags ?? []).includes("other") && (
            <textarea
              className="exp-field-input mt-2"
              value={parts.partTagsOther ?? ""}
              maxLength={200}
              rows={1}
              placeholder="补充说明：你还负责了什么？例如：对接赞助商、线下布展"
              onChange={(event) => patchParts({ partTagsOther: event.target.value })}
            />
          )}
        </fieldset>

        <fieldset className="exp-field">
          <legend className="exp-field-label">这段经历有交付物吗？（选填）</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {([["yes", "有"], ["no", "没有"], ["unsure", "不确定"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={parts.hasDeliverable === value}
                onClick={() => patchParts({ hasDeliverable: parts.hasDeliverable === value ? undefined : value })}
                className={`chip-btn ${parts.hasDeliverable === value ? "on" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
          {parts.hasDeliverable === "yes" && (
            <textarea
              className="exp-field-input mt-2"
              value={parts.deliverableNote ?? ""}
              maxLength={500}
              rows={1}
              placeholder="交付物是什么？例如：一份 20 页的分析报告 / 一个可打开的网页"
              onChange={(event) => patchParts({ deliverableNote: event.target.value })}
            />
          )}
        </fieldset>
      </div>
      <div className="experience-context">
        <label>专业 <input placeholder="选填" value={profile.major} onChange={(event) => setProfile({ ...profile, major: event.target.value })} /></label>
        <label>年级 <input placeholder="选填" value={profile.grade} onChange={(event) => setProfile({ ...profile, grade: event.target.value })} /></label>
      </div>
      <div className="experience-context">
        <label>经历类型
          <select
            value={profile.experienceType ?? ""}
            onChange={(event) => setProfile({ ...profile, experienceType: (event.target.value || undefined) as Profile["experienceType"] })}
          >
            <option value="">不填</option>
            {EXPERIENCE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label>发生时间 <input placeholder="例如：2025 秋（选填）" value={profile.experienceTimeline ?? ""} onChange={(event) => setProfile({ ...profile, experienceTimeline: event.target.value })} /></label>
      </div>
      <div className="experience-bottom"><p>只建议、不夸大。它算不算能力，由你确认。<br />请勿包含姓名、电话等个人信息。</p><button className="btn btn-primary" disabled={!filled}>记好了，去核对能力 <ArrowRight size={18} /></button></div>
    </form>
    <div className="entry-alternatives"><button className="btn btn-secondary" onClick={onEmptyCheck ?? onNext}>直接核对能力 <ArrowRight size={16} /></button>{onTrial && <button className="quiet-button" onClick={onTrial}>没方向？先做一项 15 分钟职业试驾 <ArrowRight size={15} /></button>}{onBrowseJobs && <button className="quiet-button" onClick={onBrowseJobs}>我已有目标岗位或 JD <ArrowRight size={15} /></button>}{onResume && <button className="quiet-button" onClick={onResume}>继续上次的试选 <ArrowRight size={15} /></button>}</div>
  </section>;
}
