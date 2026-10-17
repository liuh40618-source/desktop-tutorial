"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock3, Download, RotateCcw } from "lucide-react";
import type { TrialAttempt } from "@/lib/types";
import { getTrialTask, TRIAL_TASKS } from "@/lib/trial-tasks";

function currentTimestamp(): number {
  return Date.now();
}

function createTrialAttempt(taskId: string): TrialAttempt {
  const startedAt = currentTimestamp();
  return {
    id: `${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    status: "in-progress",
    answers: {},
    startedAt,
    reflection: "",
    interest: "",
  };
}

function saveMarkdown(attempts: TrialAttempt[]) {
  const entries = attempts
    .filter((attempt) => attempt.status === "completed")
    .map((attempt) => {
      const task = getTrialTask(attempt.taskId);
      if (!task) return "";
      return [
        `## ${task.role}：${task.title}`,
        `\n体验日期：${new Date(attempt.completedAt ?? attempt.startedAt).toLocaleDateString("zh-CN")}`,
        `\n体验反馈：${attempt.interest === "continue" ? "愿意继续" : attempt.interest === "stop" ? "暂时不想" : "还不确定"}`,
        ...task.prompts.map((prompt) => `\n### ${prompt.label}\n${attempt.answers[prompt.id] || "（未填写）"}`),
        `\n### 复盘\n${attempt.reflection || "（未填写）"}`,
      ].join("\n");
    })
    .filter(Boolean);
  const blob = new Blob([`# 职途 · 职业试驾记录\n\n${entries.join("\n\n---\n\n")}`], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "职途-职业试驾记录.md";
  link.click();
  URL.revokeObjectURL(url);
}

function interestLabel(interest: TrialAttempt["interest"]) {
  if (interest === "continue") return "愿意继续";
  if (interest === "stop") return "暂时不想";
  if (interest === "uncertain") return "还不确定";
  return "未反馈";
}

export function TrialLab({
  attempts,
  onChange,
  onBack,
  onContinuePlanner,
}: {
  attempts: TrialAttempt[];
  onChange: (attempts: TrialAttempt[]) => void;
  onBack: () => void;
  onContinuePlanner: () => void;
}) {
  const [activeId, setActiveId] = useState("");
  const active = attempts.find((attempt) => attempt.id === activeId);
  const task = active ? getTrialTask(active.taskId) : undefined;
  const latestOpen = useMemo(
    () => [...attempts].reverse().find((attempt) => attempt.status === "in-progress"),
    [attempts]
  );
  const completed = attempts.filter((attempt) => attempt.status === "completed");
  const tracksTried = new Set(completed.flatMap((attempt) => {
    const role = getTrialTask(attempt.taskId)?.role;
    return role ? [role] : [];
  }));

  function updateAttempt(id: string, change: Partial<TrialAttempt>) {
    onChange(attempts.map((attempt) => attempt.id === id ? { ...attempt, ...change } : attempt));
  }

  function handleStartTask(taskId: string) {
    const attempt = createTrialAttempt(taskId);
    onChange([...attempts, attempt]);
    setActiveId(attempt.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleFinishTask() {
    if (!active || !task) return;
    const completeAnswers = task.prompts.every((prompt) => (active.answers[prompt.id] ?? "").trim().length >= 3);
    if (!completeAnswers || !active.interest) return;
    updateAttempt(active.id, { status: "completed", completedAt: currentTimestamp() });
  }

  if (active && task) {
    const answersReady = task.prompts.every((prompt) => (active.answers[prompt.id] ?? "").trim().length >= 3);
    const isComplete = active.status === "completed";
    return (
      <section className="trial-lab-page">
        <button className="quiet-button" onClick={() => setActiveId("")}><ArrowLeft size={16} />返回试驾任务</button>
        <div className="trial-lab-heading">
          <span className="chapter-label">职业试驾 / {task.role}</span>
          <h1>{task.title}</h1>
          <p>{task.summary}</p>
          <span className="trial-duration"><Clock3 size={14} />约 {task.minutes} 分钟 · 不需要相关经历</span>
        </div>

        <div className="trial-task-grid">
          <article className="trial-task-brief">
            <h2>任务情境</h2>
            <p>{task.context}</p>
            <div className="trial-materials">
              {task.materials.map((material) => <div key={material.heading}><strong>{material.heading}</strong><span>{material.content}</span></div>)}
            </div>
            <div className="trial-checklist"><h3>交付时自查</h3><ul>{task.checklist.map((item) => <li key={item}><Check size={14} />{item}</li>)}</ul></div>
          </article>

          <div className="trial-task-work">
            {task.prompts.map((prompt, index) => (
              <label className="trial-answer" key={prompt.id}>
                <span><b>0{index + 1}</b>{prompt.label}</span>
                <textarea disabled={isComplete} value={active.answers[prompt.id] ?? ""} maxLength={1200} rows={3} placeholder={prompt.hint} onChange={(event) => updateAttempt(active.id, { answers: { ...active.answers, [prompt.id]: event.target.value } })} />
              </label>
            ))}

            <label className="trial-answer">
              <span>做的时候，哪一步最顺或最卡？</span>
              <textarea disabled={isComplete} value={active.reflection} maxLength={1200} rows={3} placeholder="这只是你的感受记录，不会被当作能力评分。" onChange={(event) => updateAttempt(active.id, { reflection: event.target.value })} />
            </label>

            <fieldset className="trial-interest">
              <legend>这次体验后，你愿意继续做类似的事吗？</legend>
              <div>{([ ["continue", "愿意继续"], ["uncertain", "还不确定"], ["stop", "暂时不想"] ] as const).map(([value, label]) => <button key={value} type="button" disabled={isComplete} aria-pressed={active.interest === value} onClick={() => updateAttempt(active.id, { interest: value })}>{label}</button>)}</div>
            </fieldset>

            {isComplete ? (
              <div className="trial-complete-note" role="status">
                <Check size={17} /> 已保存这次试驾。反馈是自我观察，不是职业适配度或能力评分。
              </div>
            ) : (
              <button className="btn btn-primary" disabled={!answersReady || !active.interest} onClick={handleFinishTask}>完成这次试驾 <ArrowRight size={16} /></button>
            )}
          </div>
        </div>

        {isComplete && <details className="trial-reference"><summary>查看参考核对思路</summary><ul>{task.reference.map((item) => <li key={item}>{item}</li>)}</ul></details>}
        {isComplete && <div className="trial-result-actions"><button className="btn btn-secondary" onClick={() => setActiveId("")}>再比较一个方向 <ArrowRight size={15} /></button><button className="btn btn-primary" onClick={onContinuePlanner}>继续整理经历与计划 <ArrowRight size={15} /></button></div>}
      </section>
    );
  }

  return (
    <section className="trial-lab-page">
      <div className="trial-lab-heading">
        <span className="chapter-label">不用先有经历，也能开始</span>
        <h1>先做一件小事，再看自己想不想继续。</h1>
        <p>选一个 15 分钟左右的工作样本。看任务、做交付、对照自查，再记录体验。回答会保存在当前浏览器，并同步到应用服务端的访客档案，可导出；远程部署时数据会发送到该部署服务器。请勿填写姓名、电话等敏感信息。可在「我的记录」清除全部访客数据；系统不会据此替你打职业分。</p>
      </div>

      {completed.length > 0 && <section className="trial-passport">
        <div className="trial-passport-top"><div><span className="detail-eyebrow">我的试驾档案</span><h2>你已经体验了 {tracksTried.size} 个方向</h2></div><button className="quiet-button" onClick={() => saveMarkdown(completed)}><Download size={15} />导出记录</button></div>
        <p>{completed.length === 1 ? "再试一个不同方向，会更容易比较做起来的感受。" : "把做出的东西和自己的意愿放在一起看；这些记录来自自我复盘，不是外部审核或职业适配评分。"}</p>
        <div className="trial-passport-stats"><span>{completed.length} 项任务完成</span><span>{completed.filter((attempt) => attempt.interest === "continue").length} 项愿继续</span><span>{completed.filter((attempt) => attempt.interest === "uncertain").length} 项还不确定</span><span>{completed.filter((attempt) => attempt.interest === "stop").length} 项暂不想</span></div>
        <div className="trial-passport-list">{completed.slice(-4).reverse().map((attempt) => {
          const doneTask = getTrialTask(attempt.taskId);
          if (!doneTask) return null;
          return <button key={attempt.id} onClick={() => setActiveId(attempt.id)}><span><b>{doneTask.role}</b>{doneTask.title}</span><small>{interestLabel(attempt.interest)}</small></button>;
        })}</div>
      </section>}

      {latestOpen && <button className="trial-resume" onClick={() => setActiveId(latestOpen.id)}><span>继续上次没做完的任务</span><ArrowRight size={16} /></button>}

      <div className="trial-task-cards">
        {TRIAL_TASKS.map((item) => {
          const past = attempts.filter((attempt) => attempt.taskId === item.id && attempt.status === "completed").length;
          return <article className="trial-task-card" key={item.id}>
            <div><span className="trial-role-tag">{item.role}</span><span className="trial-duration"><Clock3 size={13} />{item.minutes} 分钟</span></div>
            <p className="detail-eyebrow">{item.category}</p>
            <h2>{item.title}</h2>
            <p>{item.summary}</p>
            <button className="btn btn-secondary" onClick={() => handleStartTask(item.id)}>{past ? <RotateCcw size={15} /> : <ArrowRight size={15} />}{past ? "再试一次" : "开始试驾"}</button>
          </article>;
        })}
      </div>

      <div className="trial-lab-bottom"><p>完成一项后，可以继续体验其他方向，或回去整理自己的经历，生成个性化的长期行动计划。</p><button className="btn btn-ghost" onClick={onContinuePlanner}>继续整理经历与计划 <ArrowRight size={16} /></button><button className="quiet-button" onClick={onBack}>返回职业试选</button></div>
    </section>
  );
}
