"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, Search } from "lucide-react";
import { selectExplorations, type JobMatch } from "@/lib/matcher";
import type { Profile } from "@/lib/types";

function EvidenceStrip({ match }: { match: JobMatch }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const total = match.covered.length + match.missing.length;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const width = canvas.clientWidth;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = 28 * ratio;
      const ctx = canvas.getContext("2d");
      if (!ctx || !total) return;
      ctx.scale(ratio, ratio);
      const colors = [
        ...match.supported.map(() => "#237e66"),
        ...match.weakEvidence.map(() => "#c09c45"),
        ...match.missing.map(() => "#dce1e5"),
      ];
      const gap = Math.min(5, width / total / 4);
      colors.forEach((color, index) => {
        ctx.fillStyle = color;
        ctx.fillRect(index * width / total, 0, width / total - gap, 28);
      });
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [match, total]);
  return <figure className="evidence-strip">
    <canvas ref={ref} role="img" aria-label={`${total} 项要求：${match.supported.length} 项自评有项目，${match.weakEvidence.length} 项待补作品，${match.missing.length} 项待补技能`} />
    <figcaption><span><i className="key-project" />有项目 {match.supported.length}</span><span><i className="key-practice" />待补作品 {match.weakEvidence.length}</span><span><i className="key-missing" />待补技能 {match.missing.length}</span></figcaption>
  </figure>;
}

export function CareerChoices({ profile, matches, onSelect, onBrowse, onBack }: {
  profile: Profile;
  matches: JobMatch[];
  onSelect: (id: string) => void;
  onBrowse: () => void;
  onBack: () => void;
}) {
  const choices = selectExplorations(matches, profile.targetTracks);
  const [focusedId, setFocusedId] = useState("");
  const focused = choices.find((c) => c.match.jobId === focusedId) ?? choices[0];
  if (!focused) return <section className="trial-empty">
    <span className="chapter-label">02 / 职业试选</span><h1>还不能替你缩小范围</h1>
    <p>当前确认的能力与岗位模板没有交集。</p>
    <div className="trial-actions"><button className="btn btn-primary" onClick={onBack}>补充能力 <ArrowRight size={17} /></button><button className="quiet-button" onClick={onBrowse}>浏览岗位库 <Search size={16} /></button></div>
  </section>;
  const { match } = focused;
  return <section className="choice-page">
    <div className="chapter-heading"><div><span className="chapter-label">02 / 职业试选</span><h1>不急着定终点。<br />先挑一个值得试的方向。</h1></div><button className="quiet-button" onClick={onBrowse}><Search size={16} />全部岗位与真实 JD</button></div>
    <div className="choice-layout">
      <div className="choice-options" role="group" aria-label="候选方向">
        {choices.map(({ match: job, label, reason }, i) => <button key={job.jobId} aria-pressed={match.jobId === job.jobId} className={`choice-option ${match.jobId === job.jobId ? "chosen" : ""}`} onClick={() => setFocusedId(job.jobId)}>
          <span className="choice-index">0{i + 1}</span><span className="choice-copy"><span className="choice-label">{label} / {job.trackName}</span><strong>{job.title}</strong><span>{reason}</span></span><ArrowUpRight size={20} />
        </button>)}
      </div>
      <article className="choice-detail" aria-live="polite">
        <div className="detail-eyebrow">这条路，和你的联系</div><h2>{match.title}</h2><p className="job-summary">{match.summary}</p>
        <EvidenceStrip match={match} />
        <div className="decision-facts"><h3>已有的起点</h3><p>{match.covered.map((s) => s.name).join("、") || "暂无已确认能力"}</p><h3>先面对的缺口</h3><p>{match.missing.length ? match.missing.slice(0, 3).map((s) => s.name).join("、") : match.weakEvidence.length ? `${match.weakEvidence.slice(0, 3).map((s) => s.name).join("、")}的作品材料` : "模板要求已有自评项目支撑，下一步对照真实 JD。"}</p></div>
        <details className="reason-disclosure"><summary>选择依据与边界</summary><p>{focused.reason}；按技能向量余弦相似度排序，不代表兴趣测评或录用概率。</p><p>余弦相似度 {(match.cosineSimilarity * 100).toFixed(1)}%；核心命中 {match.signalDetection.hits} 项，漏报 {match.signalDetection.misses} 项，非核心误报 {match.signalDetection.falseAlarms ?? "不适用"} 项；d′ {match.signalDetection.dPrime?.toFixed(2) ?? "不适用"}。</p><p>信号检测标签暂来自本地岗位模板核心/非核心技能，不是录用结果。O*NET 31.0 使用 CC BY 4.0；中文岗位交叉映射需逐项核验。</p></details>
        <button className="btn btn-primary choose-target" onClick={() => onSelect(match.jobId)}><Check size={17} />就从这个方向试起 <ArrowRight size={17} /></button>
      </article>
    </div>
    <button className="quiet-button" onClick={onBack}>返回核对能力</button>
  </section>;
}
