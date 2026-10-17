"use client";

/**
 * 领域入门说明书（DomainBrief）
 *
 * 「先给地图，再要输入」：在经历采集之前，先把这行在做什么、行话怎么说、
 * 多久能入门、有什么硬门槛讲清楚，用户才有词去描述自己做过的事。
 *
 * 数据全部来自 `tracks[]` 的说明书字段（前端零硬编码文案）；
 * 时效文案必须来自 `lib/freshness.ts`，前端零硬编码时效字符串。
 */
import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { formatVerifiedAt } from "@/lib/freshness";

export interface DomainBriefTrack {
  id: string;
  name: string;
  oneLiner: string;
  subDirections: string[];
  glossary: { term: string; plain: string }[];
  entryCycle: string;
  hardThresholds: string[];
  dataNote: string;
  verifiedAt: string;
  sampleSize: number;
  confidence: string;
}

const CONFIDENCE_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

export function DomainBrief({
  track,
  onBackToResult,
  onStartExperience,
}: {
  track: DomainBriefTrack;
  onBackToResult: () => void;
  onStartExperience: () => void;
}) {
  const [copiedTerm, setCopiedTerm] = useState<string | null>(null);

  async function copyTerm(term: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(term);
        setCopiedTerm(term);
        setTimeout(() => setCopiedTerm((current) => (current === term ? null : current)), 1600);
      }
    } catch {
      /* 剪贴板不可用时静默失败，不阻断阅读 */
    }
  }

  return (
    <section className="domain-brief py-6">
      <span className="chapter-label">领域入门说明书</span>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{track.name}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{track.oneLiner}</p>
      <p className="mt-2 text-xs text-muted">
        复核时间：{formatVerifiedAt(track.verifiedAt)} · 样本量 {track.sampleSize} 个岗位 · 置信度{" "}
        {CONFIDENCE_LABEL[track.confidence] ?? track.confidence}
      </p>

      <h2 className="mt-8 text-base font-semibold text-foreground">子方向</h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {track.subDirections.map((direction) => (
          <li key={direction} className="chip">
            {direction}
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-base font-semibold text-foreground">核心术语表</h2>
      <p className="mt-1 text-xs text-muted">可以直接复制术语，拿去描述你自己做过的事。</p>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="py-2 pr-3 font-medium">术语</th>
            <th className="py-2 pr-3 font-medium">人话解释</th>
            <th className="py-2 font-medium">复制</th>
          </tr>
        </thead>
        <tbody>
          {track.glossary.map((item) => (
            <tr key={item.term} className="border-b border-border align-top">
              <td className="py-2 pr-3 text-foreground">{item.term}</td>
              <td className="py-2 pr-3 text-muted">{item.plain}</td>
              <td className="py-2">
                <button type="button" className="quiet-button" onClick={() => void copyTerm(item.term)}>
                  {copiedTerm === item.term ? "已复制" : "复制"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-8 text-base font-semibold text-foreground">入门周期</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{track.entryCycle}</p>

      <h2 className="mt-8 text-base font-semibold text-foreground">硬门槛</h2>
      {track.hardThresholds.length === 0 ? (
        <p className="mt-2 text-sm text-muted">无明显硬门槛。</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-muted">
          {track.hardThresholds.map((threshold) => (
            <li key={threshold}>· {threshold}</li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-base font-semibold text-foreground">数据口径</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{track.dataNote}</p>

      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" className="btn btn-ghost" onClick={onBackToResult}>
          <ArrowLeft size={16} /> 换一个方向看看
        </button>
        <button type="button" className="btn btn-primary" onClick={onStartExperience}>
          直接开始记录经历 <ArrowRight size={17} />
        </button>
      </div>
    </section>
  );
}
