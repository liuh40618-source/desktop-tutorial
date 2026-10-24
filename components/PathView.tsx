"use client";

/**
 * Step 4 · 定计划
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, Clock3 } from "lucide-react";
import type { JobMatch, PathItem } from "@/lib/matcher";
import { resolveUrl } from "@/lib/links";
import {
  evaluateDeliverable,
  requiredElementsFor,
  type DeliverableTypes,
  type EvaluationResult,
} from "@/lib/evaluate-deliverable";
import {
  fmtWeeks,
  type ActionEvaluation,
  type ActionEvaluationDraft,
  type ActionReview,
  type EvaluationCheck,
  type PathWorkflowDraft,
  type Profile,
} from "@/lib/types";

/** 时间戳取用放在组件外，避免在 render 作用域内直接调用不纯函数 */
function nowMs(): number {
  return Date.now();
}

interface EvalBaseline {
  before: number;
  beforeEvidence: number;
  suggested: number;
  final: number;
}

/**
 * ActionEvaluation 的本地扩展：把「评判前的覆盖率基线」一并持久化进 profile JSON，
 * 这样 navigate(2) 再回来仍能看到「X% → Y%」。lib/types.ts 本轮不可改，故用交叉类型承载。
 */
type EvaluationWithBaseline = ActionEvaluation & {
  baseline?: { coverage: number; evidenceCoverage: number };
};

export function PathView({
  match,
  path,
  hoursPerWeek,
  profile,
  setProfile,
  deliverableTypes = {},
  onSave,
  onGoRecords,
  onBack,
  completedActions,
  onToggleAction,
  actionReviews,
  onUpdateActionReview,
  onCompareDirections,
  initialWorkflowDraft,
  onWorkflowDraftChange,
}: {
  match: JobMatch;
  path: PathItem[];
  hoursPerWeek: number;
  profile: Profile;
  setProfile: (p: Profile) => void;
  deliverableTypes?: DeliverableTypes;
  onSave: () => Promise<void>;
  completedActions: string[];
  onToggleAction: (id: string) => void;
  actionReviews: Record<string, ActionReview>;
  onUpdateActionReview: (id: string, review: ActionReview) => void;
  onCompareDirections: () => void;
  onGoRecords: () => void;
  onBack: () => void;
  initialWorkflowDraft?: PathWorkflowDraft;
  onWorkflowDraftChange: (draft: PathWorkflowDraft) => void;
}) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [evalError, setEvalError] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [githubAuditing, setGithubAuditing] = useState(false);
  const [githubAuditError, setGithubAuditError] = useState("");
  const [focusedSkill, setFocusedSkill] = useState(initialWorkflowDraft?.focusedSkill ?? "");
  const [drafts, setDrafts] = useState<Record<string, ActionEvaluationDraft>>(initialWorkflowDraft?.drafts ?? {});
  const [baselines, setBaselines] = useState<Record<string, EvalBaseline>>({});
  useEffect(() => {
    onWorkflowDraftChange({ focusedSkill, drafts });
  }, [focusedSkill, drafts, onWorkflowDraftChange]);
  const totalHours = path.reduce((sum, item) => sum + item.estHours, 0);
  const pending = path.filter((item) => !completedActions.includes(`${match.jobId}:${item.skillId}:${item.kind}`));
  const first = path.find((item) => item.skillId === focusedSkill) ?? pending[0];
  const firstActionId = first ? `${match.jobId}:${first.skillId}:${first.kind}` : "";
  const firstDone = first && completedActions.includes(firstActionId);
  const firstReview = first ? actionReviews[firstActionId] : undefined;

  const emptyDraft = (item: PathItem): ActionEvaluationDraft => ({
    type: item.deliverableType || "other",
    checks: {},
    overrideLevel: null,
    reviewRequested: false,
    reviewReason: "",
  });
  const firstDraft: ActionEvaluationDraft | null = first ? drafts[firstActionId] ?? emptyDraft(first) : null;
  const requiredElements = firstDraft ? requiredElementsFor(firstDraft.type, deliverableTypes) : [];
  const evalTitle = firstReview?.artifact ?? "";
  const evalLocation = firstReview?.location ?? "";
  const evalNote = `${firstReview?.contribution ?? ""}\n${firstReview?.reflection ?? ""}`.trim();
  // 规则层只跑文本检测（不掺用户自评），用来「预勾选 + 标注规则检测到」
  const ruleEval: EvaluationResult | null = firstDraft
    ? evaluateDeliverable(
        { type: firstDraft.type, artifactTitle: evalTitle, artifactLocation: evalLocation, artifactNote: evalNote, userElementChecks: {} },
        deliverableTypes
      )
    : null;
  const effectiveChecks: Record<string, EvaluationCheck> = {};
  if (firstDraft && ruleEval) {
    for (const element of requiredElements) {
      effectiveChecks[element] =
        firstDraft.checks[element] ?? (ruleEval.confirmedElements.includes(element) ? "yes" : "unsure");
    }
  }
  const evaluation: EvaluationResult | null = firstDraft
    ? evaluateDeliverable(
        {
          type: firstDraft.type,
          artifactTitle: evalTitle,
          artifactLocation: evalLocation,
          artifactNote: evalNote,
          userElementChecks: {
            ...effectiveChecks,
            ...(firstDraft.checks.presentable ? { presentable: firstDraft.checks.presentable } : {}),
          },
        },
        deliverableTypes
      )
    : null;
  const finalLevel = firstDraft && evaluation ? firstDraft.overrideLevel ?? evaluation.suggestedLevel : 1;
  const persistedEvaluation = profile.actionEvaluations?.[firstActionId] as EvaluationWithBaseline | undefined;
  const githubAudited = persistedEvaluation?.source === "github-api" && persistedEvaluation.githubAudit?.passed === true;
  const baseline: EvalBaseline | null =
    baselines[firstActionId] ??
    (persistedEvaluation?.baseline
      ? {
          before: persistedEvaluation.baseline.coverage,
          beforeEvidence: persistedEvaluation.baseline.evidenceCoverage,
          suggested: persistedEvaluation.suggestedLevel,
          final: persistedEvaluation.finalLevel,
        }
      : null);

  function setDraft(actionId: string, item: PathItem, change: Partial<ActionEvaluationDraft>) {
    setDrafts((prev) => ({ ...prev, [actionId]: { ...(prev[actionId] ?? emptyDraft(item)), ...change } }));
  }

  /** 提交产出物 → 规则层评判 → 升级证据等级 → 重算匹配（页面 match 随 profile 自动重算） */
  function submitEvaluation(item: PathItem, actionId: string) {
    if (!firstDraft || !evaluation) return;
    if (githubAudited) {
      setEvalError("这条行动已经由服务端 GitHub 公开 API 审计并自动落库，不能用前端手动覆盖审计结果。");
      return;
    }
    setEvalError("");
    if (!evalTitle && !evalLocation && !evalNote) {
      setEvalError("请先填写作品名称、位置或你具体负责了什么，再提交评判。");
      return;
    }
    const final = firstDraft.overrideLevel ?? evaluation.suggestedLevel;
    const current = profile.evidenceLevels[item.skillId] ?? 1;
    const record: EvaluationWithBaseline = {
      actionId,
      deliverableType: firstDraft.type,
      requiredElements,
      confirmedElements: evaluation.confirmedElements,
      ruleHits: evaluation.ruleHits,
      artifactTitle: evalTitle || undefined,
      artifactLocation: evalLocation || undefined,
      suggestedLevel: evaluation.suggestedLevel,
      finalLevel: final,
      overridden: final !== evaluation.suggestedLevel,
      reviewRequested: firstDraft.reviewRequested || undefined,
      reviewReason: firstDraft.reviewReason || undefined,
      note: evalNote || undefined,
      evaluatedAt: nowMs(),
      baseline: { coverage: match.coverage, evidenceCoverage: match.evidenceCoverage },
    };
    const nextEvidence = { ...profile.evidenceLevels };
    if (final > current) nextEvidence[item.skillId] = final;
    setProfile({
      ...profile,
      evidenceLevels: nextEvidence,
      actionEvaluations: { ...(profile.actionEvaluations ?? {}), [actionId]: record },
    });
    setBaselines((prev) => ({
      ...prev,
      [actionId]: { before: match.coverage, beforeEvidence: match.evidenceCoverage, suggested: evaluation.suggestedLevel, final },
    }));
  }

  async function auditGithub(actionId: string, skillId: string) {
    setGithubAuditError("");
    setGithubAuditing(true);
    try {
      const response = await fetch("/api/github/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, skillId, githubUrl }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        profile?: Profile;
        audit?: { passed?: boolean };
      };
      if (!response.ok || !data.profile) {
        setGithubAuditError(data.error || "GitHub 审计失败，请稍后重试。");
        return;
      }
      setProfile(data.profile);
      if (data.audit?.passed) {
        setGithubAuditError("");
      } else {
        setGithubAuditError("链接已记录，但未达到自动提档门槛；可以修正链接或补充公开提交后重试。");
      }
    } catch {
      setGithubAuditError("审计请求未送达，请确认服务已启动后重试。");
    } finally {
      setGithubAuditing(false);
    }
  }

  function updateReview(id: string, change: Partial<ActionReview>) {
    const defaults: ActionReview = {
      artifact: "",
      location: "",
      contribution: "",
      reflection: "",
      interest: "",
    };
    onUpdateActionReview(id, {
      ...defaults,
      ...actionReviews[id],
      ...change,
    });
  }

  /** 岗位准备度：由技能覆盖 + 证据覆盖 + 硬门槛共同判定，给出投递建议。证据为自评，仅作方向参考。 */
  function readiness(m: JobMatch): { tone: "danger" | "accent" | "muted"; label: string; desc: string } {
    if (m.source === "jd") {
      if (m.missing.length) {
        return { tone: "accent", label: "这条 JD 仍有技能缺口", desc: `还有 ${m.missing.length} 项识别技能未在你的画像中确认；原文未标技能权重，建议先核对岗位职责和任职要求。` };
      }
      if (m.weakEvidence.length) {
        return { tone: "accent", label: "技能已确认，作品证据待补", desc: `${m.weakEvidence.length} 项技能的证据自评低于“实际项目”；先准备作品，再对照 JD 原文复核。` };
      }
      return { tone: "muted", label: "识别技能均有自评项目支撑", desc: "这不是录用判断。请逐条核对原始 JD，确认职责、经验要求和学历条件。" };
    }
    const hard = m.missing.find((s) => s.weight === 3);
    if (hard) {
      return { tone: "danger", label: "有硬门槛缺口", desc: `先补齐「${hard.name}」这类硬门槛，再谈投递` };
    }
    if (m.weakEvidence.length && m.evidenceCoverage < 70) {
      return {
        tone: "accent",
        label: "建议先补证据",
        desc: `${m.weakEvidence.length} 项能力证据偏弱（自评<3），先各补一件能展示的项目/作品再投`,
      };
    }
    if (m.coverage >= 100 && m.evidenceCoverage >= 70) {
      return { tone: "accent", label: "可直接投", desc: "必备技能已有证据覆盖，对照真实 JD 复核后即可投递" };
    }
    return { tone: "muted", label: "可边补边投", desc: "优先补高权重项，同时可投递门槛不高的岗位" };
  }

  async function handleSave() {
    setSaving(true); setSaved(false); setError("");
    try { await onSave(); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试。"); }
    finally { setSaving(false); }
  }

  return (
    <section>
      <span className="chapter-label">03 / 动手验证</span>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">先做出一件东西，再决定下一步。</h2>
      <p className="mt-1 text-sm text-muted">
        这次试选：{match.title}
      </p>

      {(() => {
        const r = readiness(match);
        const bar =
          r.tone === "danger" ? "#e6463a" : r.tone === "accent" ? "var(--accent)" : "var(--color-accent)";
        const titleCls = r.tone === "danger" ? "danger-text" : "text-accent-strong";
        return (
          <div
            className="mt-4 rounded-xl border border-[#dce6df] bg-white p-4"
            style={{ borderLeft: `4px solid ${bar}` }}
          >
            <div className={`text-sm font-semibold ${titleCls}`}>{r.label}</div>
            <p className="mt-0.5 text-xs leading-5 text-muted">{r.desc}</p>
            <p className="mt-1 text-[0.68rem] text-muted">
              依据：技能覆盖 {match.coverage}% · 项目证据覆盖 {match.evidenceCoverage}%（自评，未经验证）
            </p>
          </div>
        );
      })()}

      {first ? <article className="first-action">
        <span className="detail-eyebrow">当前这一件 / {first.kind === "evidence" ? "给已有能力补一份作品" : "练习尚未覆盖的能力"}</span>
        <h3>{first.deliverable}</h3><p>{first.acceptance}</p>
        <div className="action-time"><Clock3 size={15} />估算 {first.estHours} 小时 · 按每周 {hoursPerWeek} 小时，{fmtWeeks(first.estHours / Math.max(1, hoursPerWeek))}</div>
        <div className="trial-resources">{first.resources.map((resource) => <a key={resource.title} href={resolveUrl(resource.platform, resource.query)} target="_blank" rel="noreferrer">{resource.title}<ArrowUpRight size={13} /></a>)}</div>
        <label className="action-check"><input type="checkbox" disabled={saving} checked={!!firstDone} onChange={() => { setFocusedSkill(first.skillId); setSaved(false); setError(""); onToggleAction(firstActionId); }} />这项已完成，并按要求自查过</label>
        {firstDone && <div className="mt-5 rounded-xl border border-[#dce6df] bg-white p-4 sm:p-5">
          <h4 className="text-sm font-semibold text-foreground">把这次尝试变成下一次选择的依据</h4>
          <p className="mt-1 text-xs leading-5 text-muted">记录自己做出的成果和贡献；这些信息只作为你的自我复盘，不代表作品经过外部审核。</p>
          <p className="mt-1 text-xs leading-5 text-muted">填写内容会随经历草稿自动保存；点击下方「保存这份规划」后，也会收入记录和 Markdown 导出。</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted">作品或材料名称
              <input className="mt-1.5 w-full rounded-lg border border-[#d7dfd9] bg-white px-3 py-2 text-sm text-foreground" value={firstReview?.artifact ?? ""} onChange={(e) => updateReview(firstActionId, { artifact: e.target.value })} placeholder="例如：数据分析报告 v1" />
            </label>
            <label className="text-xs text-muted">作品链接或保存位置
              <input className="mt-1.5 w-full rounded-lg border border-[#d7dfd9] bg-white px-3 py-2 text-sm text-foreground" value={firstReview?.location ?? ""} onChange={(e) => updateReview(firstActionId, { location: e.target.value })} placeholder="可填链接、文件名或本机路径" />
            </label>
          </div>
          <label className="mt-3 block text-xs text-muted">我具体负责了什么
            <textarea className="mt-1.5 min-h-20 w-full rounded-lg border border-[#d7dfd9] bg-white px-3 py-2 text-sm leading-6 text-foreground" value={firstReview?.contribution ?? ""} onChange={(e) => updateReview(firstActionId, { contribution: e.target.value })} placeholder="写清自己做的部分、使用的方法，以及能展示的结果" />
          </label>
          <label className="mt-3 block text-xs text-muted">过程中最顺利或最卡的一步
            <textarea className="mt-1.5 min-h-16 w-full rounded-lg border border-[#d7dfd9] bg-white px-3 py-2 text-sm leading-6 text-foreground" value={firstReview?.reflection ?? ""} onChange={(e) => updateReview(firstActionId, { reflection: e.target.value })} placeholder="这能帮你分辨是技能缺口，还是不喜欢这类工作" />
          </label>
          <fieldset className="mt-4">
            <legend className="text-xs text-muted">这次体验后，你愿意继续做类似的事吗？</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {([["continue", "愿意继续"], ["uncertain", "还不确定"], ["stop", "暂时不想"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={firstReview?.interest === value} onClick={() => updateReview(firstActionId, { interest: value })} className={`rounded-full border px-3 py-1.5 text-xs ${firstReview?.interest === value ? "border-[#47765c] bg-[#edf4ef] text-[#315e46]" : "border-[#d7dfd9] text-[#66736a]"}`}>{label}</button>)}
            </div>
          </fieldset>
          {firstReview?.interest && <div className="mt-3 rounded-lg bg-[#f3f7f3] p-3" aria-live="polite">
            <p className="text-xs leading-5 text-[#426c59]">{firstReview.interest === "continue" ? "可以沿这个方向再做一项，看看是否愿意持续投入。" : firstReview.interest === "uncertain" ? "先多做一次小任务，再结合卡点判断；也可以比较其他候选。" : "把这次体验作为一条排除线索，回到方向比较看看其他候选。"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {firstReview.interest !== "stop" && pending.length > 0 && <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => setFocusedSkill(pending[0].skillId)}>{firstReview.interest === "continue" ? "开始下一项行动" : "再试一项"} <ArrowUpRight size={14} /></button>}
              <button type="button" className="quiet-button px-2 text-xs" onClick={onCompareDirections}>比较其他方向 <ArrowUpRight size={14} /></button>
            </div>
          </div>}

          <div className="work-passport mt-5 border-t border-[#e4eae6] pt-4">
            <div className="work-passport-heading"><div><span className="detail-eyebrow">作品护照 / 公开证据</span><h4 className="text-sm font-semibold text-foreground">把作品链接交给只读审计</h4></div><span className="work-passport-lock">只读 · 自动落库</span></div>
            <p className="mt-1 text-xs leading-5 text-muted">
              只请求公开 GitHub API 的 commits 与 languages，不 clone 仓库、不读取源码。它只记录公开活动证据，不判断原创度或作品质量。
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                className="input min-w-0 flex-1 py-2! text-sm!"
                value={githubAudited ? (persistedEvaluation?.artifactLocation ?? githubUrl) : githubUrl}
                onChange={(event) => setGithubUrl(event.target.value)}
                readOnly={githubAudited}
                placeholder="https://github.com/用户名/仓库名"
                aria-label="公开 GitHub 仓库链接"
              />
              <button
                type="button"
                className="btn btn-primary shrink-0 px-4 py-2 text-xs"
                disabled={githubAuditing || githubAudited || !githubUrl}
                onClick={() => void auditGithub(firstActionId, first.skillId)}
              >
                {githubAuditing ? "正在读取公开证据…" : githubAudited ? "已自动落库" : "生成作品护照"}
              </button>
            </div>
            <p className="mt-1.5 text-[0.68rem] text-muted">仅接受严格格式：`https://github.com/用户名/仓库名`，不接受查询参数、片段、尾斜杠或其他域名。</p>
            {githubAudited && persistedEvaluation?.githubAudit && (
              <div className="work-passport-result mt-3 rounded-lg bg-[#f3f7f3] p-3 text-xs text-[#426c59]">
                <p className="work-passport-result-title">作品护照已生成</p><p className="mt-1">公开活动：{persistedEvaluation.githubAudit.commitCount} 个 commit · {persistedEvaluation.githubAudit.languageCount} 种语言 · 自动证据等级 {persistedEvaluation.finalLevel}。</p>
                <p className="mt-1">这是公开活动的规则证据，不等同于人工确认原创度；该结果锁定，前端不能越权覆盖。</p>
              </div>
            )}
            {githubAuditError && <p role="alert" className="danger-text mt-2 text-xs">{githubAuditError}</p>}
          </div>

          {firstDraft && evaluation && ruleEval && (
            <div className="mt-5 border-t border-[#e4eae6] pt-4">
              <h4 className="text-sm font-semibold text-foreground">提交产出物并评判</h4>
              <p className="mt-1 text-xs leading-5 text-muted">
                勾选完成不会提升技能或证据等级；<b className="text-foreground">提交产出物并通过规则层评判才会提升</b>。
                规则层只做可机器检测的文本检查，不会替你做判断。
              </p>

              <label className="mt-3 block text-xs text-muted">交付物类型（系统按技能带入，可改）
                <select
                  className="input mt-1.5 w-full py-2! text-sm!"
                  value={firstDraft.type}
                  onChange={(e) => setDraft(firstActionId, first, { type: e.target.value, checks: {}, overrideLevel: null })}
                >
                  {Object.entries(deliverableTypes).map(([key, def]) => (
                    <option key={key} value={key}>
                      {def.label ?? key}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-3 space-y-2">
                {requiredElements.map((element) => {
                  const ruleHit = ruleEval.ruleHits.some((h) => h.startsWith(element));
                  const value = effectiveChecks[element];
                  return (
                    <div key={element} className="rounded-lg bg-[var(--surface-2)] px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-foreground">{element}</span>
                        {ruleHit ? (
                          <span className="tag w1">规则检测到</span>
                        ) : (
                          <span className="tag">未检测到，请人工确认</span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {([["yes", "有"], ["no", "无"], ["unsure", "不确定"]] as const).map(([v, label]) => (
                          <button
                            key={v}
                            type="button"
                            aria-pressed={value === v}
                            onClick={() => setDraft(firstActionId, first, { checks: { ...firstDraft.checks, [element]: v } })}
                            className={`rounded-full border px-2.5 py-1 text-[0.7rem] ${value === v ? "border-[#47765c] bg-[#edf4ef] text-[#315e46]" : "border-[#d7dfd9] text-[#66736a]"}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <label className="mt-3 flex items-start gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={firstDraft.checks.presentable === "yes"}
                  onChange={(e) => setDraft(firstActionId, first, { checks: { ...firstDraft.checks, presentable: e.target.checked ? "yes" : "no" } })}
                />
                成果可展示（有可访问的链接/文件；纯文字描述不计入等级 4）
              </label>

              <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
                <div className="text-xs font-medium text-foreground">我看了你的什么</div>
                {ruleEval.ruleHits.length ? (
                  <ul className="mt-1.5 space-y-1 text-[0.7rem] text-muted">
                    {ruleEval.ruleHits.map((hit) => (
                      <li key={hit}>· {hit}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-[0.7rem] text-muted">未检测到（规则不会替你做判断）。</p>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="text-xs text-muted">
                  规则层建议等级：<b className="text-foreground">{evaluation.suggestedLevel}</b> / 4
                </span>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  你的最终等级
                  <select
                    className="input w-auto! py-1! text-xs!"
                    value={finalLevel}
                    disabled={githubAudited}
                    onChange={(e) => setDraft(firstActionId, first, { overrideLevel: Number(e.target.value) })}
                  >
                    {[1, 2, 3, 4].map((lv) => (
                      <option key={lv} value={lv}>
                        {lv}
                      </option>
                    ))}
                  </select>
                </label>
                {firstDraft.overrideLevel !== null && firstDraft.overrideLevel !== evaluation.suggestedLevel && (
                  <span className="tag text-amber-600">已推翻规则建议</span>
                )}
              </div>
              <p className="mt-1 text-[0.68rem] text-muted">
                等级 5（岗位或实习）只能由你在上方「证据」下拉里自评，规则层最高给 4——不把个人作品拔高成岗位经验。
              </p>

              <label className="mt-3 flex items-start gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={firstDraft.reviewRequested}
                  disabled={githubAudited}
                  onChange={(e) => setDraft(firstActionId, first, { reviewRequested: e.target.checked })}
                />
                申请复核（零 LLM：标记为「待线下确认」并进入个人待办；不会显示「已核验」）
              </label>
              {firstDraft.reviewRequested && (
                <textarea
                  className="mt-2 min-h-16 w-full rounded-lg border border-[#d7dfd9] bg-white px-3 py-2 text-sm leading-6 text-foreground"
                  value={firstDraft.reviewReason}
                  onChange={(e) => setDraft(firstActionId, first, { reviewReason: e.target.value })}
                  placeholder="想请人帮忙确认什么？（例如：这份报告的数据来源算不算可核对材料）"
                />
              )}

              <button
                type="button"
                className="btn btn-primary mt-3 px-4 py-2 text-xs"
                disabled={githubAudited}
                onClick={() => submitEvaluation(first, firstActionId)}
              >
                提交产出物并评判
              </button>
              {evalError && <p role="alert" className="danger-text mt-2 text-xs">{evalError}</p>}

              {persistedEvaluation && (
                <div className="mt-3 rounded-lg bg-[#f3f7f3] p-3 text-xs" aria-live="polite">
                  <p className="text-[#426c59]">
                    已评判：最终等级 {persistedEvaluation.finalLevel}（规则建议 {persistedEvaluation.suggestedLevel}
                    {persistedEvaluation.overridden ? "，你已推翻" : ""}）
                    {persistedEvaluation.reviewRequested ? " · 已申请复核，待线下确认" : ""}
                  </p>
                  {baseline && (
                    <p className="mt-1 text-[#426c59]">
                      技能覆盖 {baseline.before}% → {match.coverage}% · 项目证据覆盖 {baseline.beforeEvidence}% →{" "}
                      {match.evidenceCoverage}%
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>}
        {firstDone && <p className="mt-3">已标记完成。{pending.length ? firstReview?.interest ? null : <button className="quiet-button" onClick={() => setFocusedSkill(pending[0].skillId)}>查看下一项待办 <ArrowUpRight size={14} /></button> : "本轮没有剩余行动。可结合上面的体验反馈，复核作品和真实 JD。"}</p>}
      </article> : path.length > 0 && <div className="first-action"><h3>本轮行动已完成。</h3><p>请评估作品是否能体现你的个人贡献，以及完成过程是否值得继续投入，再决定是否保留当前方向。</p></div>}
      <div className="plan-overview"><span>{pending.length} 项待完成 / {path.length} 项行动</span><span>完整清单估算 {totalHours} 小时</span><span>技能覆盖 {match.coverage}% · 不是录用概率</span></div>

      {!path.length ? (
        <div className="card mt-4 p-8 text-center text-sm text-muted">
          必备技能已全部覆盖。投递前建议对照真实 JD 复核。
        </div>
      ) : (
        <details className="plan-backlog mt-4"><summary>完整行动清单与完成记录</summary><div className="space-y-3">
          {path.map((item, i) => (
            <div key={item.skillId} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-medium text-accent-strong">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">
                        {item.name}
                      </span>
                      <span className={`tag ${match.source === "jd" ? "w1" : `w${item.weight}`}`}>
                        {match.source === "jd" ? "JD 等权" : item.weight === 3 ? "硬门槛" : item.weight === 2 ? "重要" : "加分"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {item.kind === "evidence" ? "补作品" : "补技能"} ·
                      约 {item.estHours} 小时 · 优先级 {item.priority} · 累计第{" "}
                      {item.cumulativeWeeks} 周
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-2.5 space-y-1">
                <h3 className="text-sm font-semibold">{item.deliverable}</h3>
                <p className="text-xs text-muted pb-2">验收：{item.acceptance}</p>
                <label className="flex items-center gap-2 text-xs py-2">
                  <input
                    type="checkbox"
                    disabled={saving}
                    checked={completedActions.includes(`${match.jobId}:${item.skillId}:${item.kind}`)}
                    onChange={() => {
                      setSaved(false);
                      setError("");
                      onToggleAction(`${match.jobId}:${item.skillId}:${item.kind}`);
                    }}
                  />
                  已完成并自查交付物
                </label>
                <button type="button" className="text-xs text-[#426c59] underline underline-offset-2" onClick={() => { setFocusedSkill(item.skillId); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                  {actionReviews[`${match.jobId}:${item.skillId}:${item.kind}`]?.interest ? "查看这项体验复盘" : "查看行动并记录体验"}
                </button>
                {actionReviews[`${match.jobId}:${item.skillId}:${item.kind}`]?.artifact && <p className="mt-1 text-xs text-muted">作品：{actionReviews[`${match.jobId}:${item.skillId}:${item.kind}`].artifact}</p>}
                {item.resources.map((r) => (
                  <a
                    key={r.title}
                    href={resolveUrl(r.platform, r.query)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent-soft"
                  >
                    <span className="truncate">{r.title}</span>
                    <span className="shrink-0 text-muted">{r.platform}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div></details>
      )}

      <div className="mt-5 flex gap-3">
        <button onClick={onBack} className="btn btn-ghost flex-1">
          返回上一步
        </button>
        <button onClick={handleSave} disabled={saving} className="btn btn-primary flex-1">
          {saving ? "保存中…" : saved ? "已保存" : "保存这份规划"}
        </button>
      </div>

      {saved && (
        <p className="mt-3 text-center text-xs text-accent">
          已写入「我的记录」
          <button onClick={onGoRecords} className="ml-2 underline underline-offset-2">
            前往我的记录
          </button>
        </p>
      )}

      <p className="mt-3 text-[0.7rem] leading-relaxed text-muted">
        {error && <span role="alert" className="danger-text">{error}</span>}
        勾选完成不会提升技能或证据等级；提交产出物并通过规则层评判才会提升。
        时长为经验估算，用于排序参考；资源链接为平台搜索结果，内容以最新版本为准。
      </p>
    </section>
  );
}
