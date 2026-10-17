"use client";

/**
 * 开场定位门（OpeningGate）
 *
 * ⚠️ 与 `components/Orientation.tsx`（岗位库页的「方向匹配概览」）是两件事，禁止混用。
 *
 * 结构：第一屏（无输入框）→ 01 工作内容排除（≤4）→ 02 工作条件排除（≤3）
 *       → 03 已有基础盘点（选填）→ 输出页。
 *
 * 事实约束（T02.5 已定稿）：
 *  - 9 个内容选项里只有 4 个能排掉方向，其余 5 个只在**岗位级**生效 →
 *    输出页必须展示「另排除 N 个具体岗位」，否则用户会以为系统没听他说话。
 *  - 7 个条件选项**恒定不参与排除**（contextExclusionApplied=false），只作自我清单。
 *  - 第 1 步上限 4 是承重结构：4 项是最激进的组合仍能留下候选，全选会产生空结果。
 */
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DATA_META } from "@/lib/matcher";
import { computeOrientation, type OrientationKB } from "@/lib/orientation";
import type { OrientationResult } from "@/lib/types";

export interface OpeningBasics {
  major: string;
  skillItemIds: string[];
  experienceType: "" | "course" | "competition" | "club" | "internship" | "parttime" | "personal" | "none";
  hoursPerWeek: number;
}

type Stage = "intro" | "content" | "context" | "basics" | "result";

const CONTENT_LIMIT = 4;
const CONTEXT_LIMIT = 3;
const HOURS_OPTIONS = [5, 10, 20, 30];
const MAJOR_OPTIONS = ["计算机 / 软件", "电子信息", "数学 / 统计", "经济 / 管理", "文科 / 语言", "艺术 / 设计", "其他"];
const EXPERIENCE_TYPES: { value: OpeningBasics["experienceType"]; label: string }[] = [
  { value: "", label: "不填" },
  { value: "course", label: "课程项目" },
  { value: "competition", label: "竞赛" },
  { value: "club", label: "社团" },
  { value: "internship", label: "实习" },
  { value: "parttime", label: "兼职" },
  { value: "personal", label: "个人作品" },
  { value: "none", label: "暂无" },
];

const STAGE_LABEL: Record<Stage, string> = {
  intro: "开场定位",
  content: "01 / 工作内容排除",
  context: "02 / 工作条件排除",
  basics: "03 / 已有基础盘点",
  result: "定位结果",
};

export function OpeningGate({
  kb,
  initialResult = null,
  initialBasics = null,
  onComplete,
  onSkip,
  onOpenBrief,
}: {
  kb: OrientationKB;
  initialResult?: OrientationResult | null;
  initialBasics?: OpeningBasics | null;
  onComplete: (result: OrientationResult, basics: OpeningBasics) => void;
  onSkip: () => void;
  onOpenBrief: (trackId: string, result: OrientationResult, basics: OpeningBasics) => void;
}) {
  const [stage, setStage] = useState<Stage>(initialResult ? "result" : "intro");
  const [contentIds, setContentIds] = useState<string[]>(initialResult?.contentExcluded ?? []);
  const [contextIds, setContextIds] = useState<string[]>(initialResult?.contextExcluded ?? []);
  const [contentHistory, setContentHistory] = useState<string[]>([]);
  const [basics, setBasics] = useState<OpeningBasics>(
    initialBasics ?? { major: "", skillItemIds: [], experienceType: "", hoursPerWeek: 10 }
  );
  const [expanded, setExpanded] = useState(false);

  const contentOptions = kb.contentOptions ?? [];
  const contextOptions = kb.contextOptions ?? [];
  const starterSkills = kb.starterSkills ?? [];

  const mappedSkillIds = useMemo(
    () =>
      (kb.starterSkills ?? [])
        .filter((item) => basics.skillItemIds.includes(item.id))
        .flatMap((item) => item.skillIds),
    [kb.starterSkills, basics.skillItemIds]
  );

  // 纯函数实时计算：勾选即时可见「将被排除的方向」预览
  const result = useMemo(
    () =>
      computeOrientation(
        { contentOptionIds: contentIds, contextOptionIds: contextIds, knownSkillIds: mappedSkillIds },
        kb
      ),
    [contentIds, contextIds, mappedSkillIds, kb]
  );

  const trackName = (id: string) => kb.tracks.find((t) => t.id === id)?.name ?? id;
  const goStage = (next: Stage) => {
    setStage(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" });
  };

  function toggleContent(id: string) {
    if (contentIds.includes(id)) {
      setContentIds(contentIds.filter((x) => x !== id));
      setContentHistory(contentHistory.filter((x) => x !== id));
      return;
    }
    if (contentIds.length >= CONTENT_LIMIT) return;
    setContentIds([...contentIds, id]);
    setContentHistory([...contentHistory, id]);
  }

  function toggleContext(id: string) {
    if (contextIds.includes(id)) {
      setContextIds(contextIds.filter((x) => x !== id));
      return;
    }
    if (contextIds.length >= CONTEXT_LIMIT) return;
    setContextIds([...contextIds, id]);
  }

  /** 一键回退最近一项内容排除（只有内容选项影响排除结果） */
  function relaxLastExclusion() {
    const last = contentHistory[contentHistory.length - 1];
    if (!last) return;
    setContentHistory(contentHistory.slice(0, -1));
    setContentIds(contentIds.filter((x) => x !== last));
  }

  const jobGroups = result.contentExcluded
    .map((id) => {
      const option = contentOptions.find((o) => o.id === id);
      if (!option) return null;
      const titles = result.excludedJobs.filter((job) => job.tagIds.includes(option.tag)).map((job) => job.title);
      return { id, label: option.label, titles };
    })
    .filter((group): group is { id: string; label: string; titles: string[] } => group !== null);

  return (
    <section className="opening-gate">
      <header className="flex items-center justify-between gap-4 border-b border-border pb-3">
        <span className="text-xs text-muted">{STAGE_LABEL[stage]}</span>
        <button type="button" className="quiet-button" onClick={onSkip}>
          跳过定位
        </button>
      </header>

      {stage === "intro" && (
        <div className="animate-step py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">先别急着回答「我会什么」。</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            很多人卡在第一步：还没想清楚要去哪，就被要求先证明自己有什么。这一步先给你一张地图——
            用「我确定不想要什么」排除方向，再看剩下哪些值得试。
          </p>
          <div className="mt-8 flex flex-col items-start gap-4">
            <button type="button" className="btn btn-primary" onClick={() => goStage("content")}>
              开始定位 · 约 3 分钟 <ArrowRight size={17} />
            </button>
            <button type="button" className="quiet-button" onClick={onSkip}>
              已经想清楚了？直接选方向
            </button>
          </div>
          <p className="mt-10 text-xs text-muted">
            {kb.jobs.length} 岗 / {kb.tracks.length} 方向 · 数据版本 {DATA_META.version || "—"} · 人工整理，可复核
          </p>
        </div>
      )}

      {stage === "content" && (
        <div className="animate-step py-6">
          <span className="chapter-label">01 / 工作内容排除</span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">你确定不想做哪些工作内容？</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            勾选「工作的真实体感」（最多 {CONTENT_LIMIT} 项）。系统会据此排除相应岗位与方向；不确定就跳过。
          </p>
          <ul className="mt-5 divide-y divide-border border-y border-border">
            {contentOptions.map((option) => {
              const checked = contentIds.includes(option.id);
              const disabled = !checked && contentIds.length >= CONTENT_LIMIT;
              return (
                <li key={option.id}>
                  <label className={`flex items-start gap-3 py-3 ${disabled ? "opacity-45" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      className="mt-1.5"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleContent(option.id)}
                    />
                    <span className="text-sm leading-relaxed text-foreground">{option.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">
            已选 {contentIds.length}/{CONTENT_LIMIT}
            {contentIds.length >= CONTENT_LIMIT ? " · 已选满，取消一项后可换选" : ""}
          </p>
          <p className="mt-2 text-xs text-muted">
            按当前选择：将排除 {result.excludedJobIds.length} 个岗位、{result.excludedTrackIds.length} 个方向。
            {result.excludedTrackIds.length > 0 && `将被排除的方向：${result.excludedTrackIds.map(trackName).join("、")}。`}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="btn btn-ghost" onClick={() => goStage("intro")}>
              <ArrowLeft size={16} /> 上一步
            </button>
            <button type="button" className="btn btn-primary" onClick={() => goStage("context")}>
              下一步 <ArrowRight size={17} />
            </button>
          </div>
        </div>
      )}

      {stage === "context" && (
        <div className="animate-step py-6">
          <span className="chapter-label">02 / 工作条件排除</span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">哪些工作条件你接受不了？</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            这是给你自己看的筛选条件，不是承诺。勾选最多 {CONTEXT_LIMIT} 项。
          </p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">
            知识库目前没有工作条件数据，未据此排除方向——这里只帮你把「接受不了什么」记下来。
          </p>
          <ul className="mt-5 divide-y divide-border border-y border-border">
            {contextOptions.map((option) => {
              const checked = contextIds.includes(option.id);
              const disabled = !checked && contextIds.length >= CONTEXT_LIMIT;
              return (
                <li key={option.id}>
                  <label className={`flex items-start gap-3 py-3 ${disabled ? "opacity-45" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      className="mt-1.5"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleContext(option.id)}
                    />
                    <span className="text-sm leading-relaxed text-foreground">{option.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">
            已选 {contextIds.length}/{CONTEXT_LIMIT}（这些选项不参与排除，只作自我清单）
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="btn btn-ghost" onClick={() => goStage("content")}>
              <ArrowLeft size={16} /> 上一步
            </button>
            <button type="button" className="btn btn-primary" onClick={() => goStage("basics")}>
              下一步 <ArrowRight size={17} />
            </button>
          </div>
        </div>
      )}

      {stage === "basics" && (
        <div className="animate-step py-6">
          <span className="chapter-label">03 / 已有基础盘点</span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">有就勾，没有就跳过。</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            这一步是「取」，不是「排」——只用来让后面的候选方向更贴合你。全部选填，可以直接跳过。
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="lbl">专业大类</span>
              <select
                className="input"
                value={basics.major}
                onChange={(event) => setBasics({ ...basics, major: event.target.value })}
              >
                <option value="">不填</option>
                {MAJOR_OPTIONS.map((major) => (
                  <option key={major} value={major}>
                    {major}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="lbl">经历类型</span>
              <select
                className="input"
                value={basics.experienceType}
                onChange={(event) =>
                  setBasics({ ...basics, experienceType: event.target.value as OpeningBasics["experienceType"] })
                }
              >
                {EXPERIENCE_TYPES.map((type) => (
                  <option key={type.value || "none-value"} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="mt-6">
            <legend className="lbl">技能基础（多选，选填）</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {starterSkills.map((item) => {
                const checked = basics.skillItemIds.includes(item.id);
                return (
                  <label key={item.id} className="flex items-start gap-3 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1.5"
                      checked={checked}
                      onChange={() =>
                        setBasics({
                          ...basics,
                          skillItemIds: checked
                            ? basics.skillItemIds.filter((x) => x !== item.id)
                            : [...basics.skillItemIds, item.id],
                        })
                      }
                    />
                    <span className="text-sm text-foreground">{item.label}</span>
                  </label>
                );
              })}
            </div>
            <p className="hint">勾选的技能会以「课程或练习（等级 2）」预填，标注「自评，可调」，你可以在下一步调整。</p>
          </fieldset>

          <label className="mt-6 block max-w-xs">
            <span className="lbl">每周可投入</span>
            <select
              className="input"
              value={basics.hoursPerWeek}
              onChange={(event) => setBasics({ ...basics, hoursPerWeek: Number(event.target.value) || 10 })}
            >
              {HOURS_OPTIONS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours} 小时
                </option>
              ))}
            </select>
          </label>

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="btn btn-ghost" onClick={() => goStage("context")}>
              <ArrowLeft size={16} /> 上一步
            </button>
            <button type="button" className="btn btn-primary" onClick={() => goStage("result")}>
              看定位结果 <ArrowRight size={17} />
            </button>
          </div>
        </div>
      )}

      {stage === "result" && (
        <div className="animate-step py-6">
          <span className="chapter-label">定位结果</span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {result.candidates.length > 0 ? "这是基于你的偏好与基础，先圈出来的几个方向。" : "你排除了所有方向。"}
          </h1>

          {result.candidates.length === 0 ? (
            <div className="trial-empty">
              <h2>要不要放宽一项？</h2>
              <p>当前选择把 {kb.tracks.length} 个方向全部排除了，系统不会给出候选。回退最近一项排除，或重新选择。</p>
              <div className="trial-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={contentHistory.length === 0}
                  onClick={relaxLastExclusion}
                >
                  放宽最近一项排除
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => goStage("content")}>
                  重新选择
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* 1. 已排除方向 */}
              <h2 className="mt-8 text-base font-semibold text-foreground">已排除的方向</h2>
              {result.excludedReasons.length === 0 ? (
                <p className="mt-2 text-sm text-muted">没有整体排除任何方向。</p>
              ) : (
                <table className="mt-2 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="py-2 pr-3 font-medium">方向</th>
                      <th className="py-2 font-medium">为什么排除</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.excludedReasons.map((item) => (
                      <tr key={item.trackId} className="border-b border-border align-top">
                        <td className="py-2 pr-3 text-foreground">{item.trackName}</td>
                        <td className="py-2 text-muted">
                          {item.reason}
                          {item.assumed && "（此项为人工初判，待校准）"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* 2. 部分相关方向 */}
              {result.partialTrackIds.length > 0 && (
                <>
                  <h2 className="mt-8 text-base font-semibold text-foreground">部分相关，未整体排除</h2>
                  <ul className="mt-2 space-y-1 text-sm text-muted">
                    {result.partialTrackIds.map((trackId) => {
                      const count = result.excludedJobs.filter((job) => job.trackId === trackId).length;
                      return (
                        <li key={trackId}>
                          · {trackName(trackId)}：该方向有 {count} 个岗位被排除，未整体排除
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {/* 3. 岗位级排除（本轮重点） */}
              <h2 className="mt-8 text-base font-semibold text-foreground">
                另排除 {result.excludedJobs.length} 个具体岗位
              </h2>
              <p className="mt-1 text-xs text-muted">
                这些方向没有被整体排除，但下面这些具体岗位的核心工作正是你不想要的。
              </p>
              {jobGroups.length === 0 ? (
                <p className="mt-2 text-sm text-muted">没有排除任何具体岗位。</p>
              ) : (
                <>
                  <table className="mt-2 w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted">
                        <th className="py-2 pr-3 font-medium">你勾选的内容</th>
                        <th className="py-2 pr-3 font-medium">岗位数</th>
                        <th className="py-2 font-medium">具体岗位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobGroups.map((group) => (
                        <tr key={group.id} className="border-b border-border align-top">
                          <td className="py-2 pr-3 text-foreground">{group.label}</td>
                          <td className="num py-2 pr-3 text-muted">{group.titles.length}</td>
                          <td className="py-2 text-muted">
                            {(expanded ? group.titles : group.titles.slice(0, 8)).join("、")}
                            {!expanded && group.titles.length > 8 ? ` 等 ${group.titles.length} 个` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {jobGroups.some((group) => group.titles.length > 8) && (
                    <button
                      type="button"
                      className="quiet-button mt-2"
                      onClick={() => setExpanded((value) => !value)}
                    >
                      {expanded ? "收起岗位清单" : "展开全部岗位"}
                    </button>
                  )}
                </>
              )}

              {/* 4. 候选 Top 3 */}
              <h2 className="mt-8 text-base font-semibold text-foreground">候选方向（Top {result.candidates.length}）</h2>
              <table className="mt-2 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">方向</th>
                    <th className="py-2 pr-3 font-medium">等级</th>
                    <th className="py-2 pr-3 font-medium">依据</th>
                    <th className="py-2 font-medium">待确认</th>
                  </tr>
                </thead>
                <tbody>
                  {result.candidates.map((candidate) => (
                    <tr key={candidate.trackId} className="border-b border-border align-top">
                      <td className="py-3 pr-3">
                        <span className="block text-foreground">{candidate.trackName}</span>
                        <button
                          type="button"
                          className="quiet-button mt-1"
                          onClick={() => onOpenBrief(candidate.trackId, result, basics)}
                        >
                          看这个方向的入门说明书 <ArrowRight size={14} />
                        </button>
                      </td>
                      <td className="py-3 pr-3">
                        <span className="tag w1">{candidate.level}</span>
                      </td>
                      <td className="py-3 pr-3 text-muted">
                        <ul className="space-y-1">
                          {candidate.reasons.map((reason) => (
                            <li key={reason}>· {reason}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="py-3 text-muted">
                        <ul className="space-y-1">
                          {candidate.pending.map((item) => (
                            <li key={item}>· {item}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-sm text-foreground">这是基于你偏好与基础的初筛，不是能力评估。</p>
            </>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" className="btn btn-ghost" onClick={() => goStage("basics")}>
              <ArrowLeft size={16} /> 上一步
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onComplete(result, basics)}>
              直接开始记录经历 <ArrowRight size={17} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
