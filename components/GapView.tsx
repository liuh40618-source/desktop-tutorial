"use client";

/**
 * Step 3 · 查差距
 */
import { buildGapMap, SKILL_MAP, type JobMatch } from "@/lib/matcher";
import { formatVerifiedAt } from "@/lib/freshness";
import { evidenceLabel } from "@/lib/types";

const CONFIDENCE_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

interface SkillMeta {
  verified_at?: string;
  sample_size?: number;
  confidence?: string;
}

/** 技能卡时效口径：全部来自 formatVerifiedAt，前端零硬编码时效字符串 */
function skillFreshnessText(id: string): string | null {
  const meta = SKILL_MAP[id] as unknown as SkillMeta | undefined;
  if (!meta?.verified_at) return null;
  return `数据：${formatVerifiedAt(meta.verified_at)} · 样本 ${meta.sample_size ?? 0} · 置信度 ${CONFIDENCE_LABEL[meta.confidence ?? ""] ?? "—"}`;
}

export function GapView({
  match,
  gapMap,
  sourceText,
  evidenceLevels = {},
  jobMeta,
  onBack,
  onNext,
}: {
  match: JobMatch;
  gapMap: ReturnType<typeof buildGapMap>;
  sourceText?: string;
  evidenceLevels?: Record<string, number>;
  /** 岗位数据时效（来自知识库 jobs[].verified_at / sample_size / confidence） */
  jobMeta?: { verifiedAt?: string; sampleSize?: number; confidence?: string };
  onBack: () => void;
  onNext: () => void;
}) {
  const rows = [...match.covered, ...match.missing].sort((a, b) => b.weight - a.weight);
  const totalCore = rows.length;
  const coveredCount = match.supported.length;
  const missingHard = match.missing.filter((s) => s.weight === 3);

  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">检查我的岗位证据</h2>
      <p className="mt-1 text-sm text-muted">
        {match.source === "jd"
          ? <>目标 JD {match.title} · 规则识别到 {totalCore} 项技能，自评有项目经历支撑 {coveredCount} 项（证据覆盖 {match.evidenceCoverage}%）</>
          : <>目标岗位 {match.title} · 必备 {totalCore} 项，自评有项目经历支撑 {coveredCount} 项（证据覆盖 {match.evidenceCoverage}%）</>}
      </p>
      <p className="mt-1 text-xs text-muted">
        技能覆盖 {match.coverage}% 与项目证据覆盖分别计算。证据等级由你自评，不等同于第三方核验。
      </p>
      {match.source === "jd" && sourceText && <details className="reason-disclosure mt-3">
        <summary>核对这条 JD 原文</summary>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-2)] p-3 text-xs leading-6 text-muted">{sourceText}</pre>
      </details>}

      <div className="card mt-5 p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-medium text-foreground">这个岗位要求什么</h3>
          <span className="shrink-0 text-[0.68rem] text-muted">
            {match.source === "jd" ? "JD 未标权重 · 识别技能等权计算" : "权重 3=硬门槛 · 2=重要 · 1=加分"}
          </span>
        </div>
        {match.source !== "jd" && jobMeta && (
          <p className="mt-1 text-[0.68rem] text-muted">
            岗位数据：复核时间 {formatVerifiedAt(jobMeta.verifiedAt)} · 样本量 {jobMeta.sampleSize ?? 0} 个岗位 · 置信度{" "}
            {CONFIDENCE_LABEL[jobMeta.confidence ?? ""] ?? "—"}
          </p>
        )}
        {missingHard.length > 0 && (
          <div className="mt-3 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs leading-relaxed text-foreground">
            <span className="tag w3 mr-1">硬门槛缺失</span>
            还差 {missingHard.map((s) => s.name).join("、")}。这类通常是投递初筛的硬条件，应优先补齐。
          </div>
        )}
        <div className="mt-3 space-y-2">
          {rows.map((s) => {
            const known = match.covered.some((c) => c.id === s.id);
            const supported = known && (evidenceLevels[s.id] ?? 1) >= 3;
            return (
              <div key={s.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`shrink-0 text-xs ${known ? "text-accent" : "text-muted"}`}
                  >
                    {supported ? "有项目" : known ? "待补证据" : "待补技能"}
                  </span>
                  <span className="truncate text-sm text-foreground">{s.name}</span>
                  <span className={`tag ${match.source === "jd" ? "w1" : `w${s.weight}`} shrink-0`}>
                    {match.source === "jd" ? "等权" : s.weight === 3 ? "硬门槛" : s.weight === 2 ? "重要" : "加分"}
                  </span>
                </div>
                <span className="shrink-0 text-right text-xs text-muted">
                  {known ? (
                    <>
                      证据 <b className="text-foreground">{evidenceLabel(evidenceLevels[s.id] ?? 1)}</b>
                    </>
                  ) : (
                    `约 ${s.estHours}h`
                  )}
                  {skillFreshnessText(s.id) && (
                    <span className="mt-0.5 block text-[0.62rem]">{skillFreshnessText(s.id)}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[0.68rem] text-muted">
          项目证据覆盖只计入自评等级 ≥ 3 的能力（0 未提及 → 5 岗位/实习）。
          {match.source === "jd" ? " JD 识别结果不等于招聘方权重，请对照原文逐项确认。" : " 证据＜3 的已具备能力，投递前通常建议先补一个能拿出来展示的项目/作品。"}
        </p>

        {match.plusCovered.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <div className="text-xs text-muted">你已具备的加分项</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {match.plusCovered.map((n) => (
                <span key={n} className="tag w2">
                  {n}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card mt-4 p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-medium text-foreground">相近岗位横向对比</h3>
          {gapMap.jobs.length > 0 && (
            <span className="shrink-0 text-[0.68rem] text-muted">
              与目标岗位最接近的 {gapMap.jobs.length} 个
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          被越多岗位要求的技能，越应优先补齐。表格支持横向滑动。
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th className="matrix-sticky text-left font-medium text-muted">技能</th>
                {gapMap.jobs.map((j) => (
                  <th key={j.jobId} className="align-bottom font-medium text-muted">
                    <div className="w-24">
                      <div className="clamp-2 leading-tight" title={j.title}>
                        {j.title}
                      </div>
                      <div className="num mt-0.5 text-[0.62rem] text-muted">
                        覆盖 {j.coverage}%
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gapMap.skills.map((s) => (
                <tr key={s.id}>
                  <td className="matrix-sticky whitespace-nowrap">
                    <span className={s.known ? "text-foreground" : "text-muted"}>
                      {s.known ? "✓ " : "· "}
                      {s.name}
                    </span>
                  </td>
                  {gapMap.jobs.map((j) => (
                    <td key={j.jobId}>
                      <div
                        className={`cell ${
                          !s.requiredByJobIds.includes(j.jobId)
                            ? "cell-na"
                            : s.known
                              ? "cell-yes"
                              : "cell-no"
                        }`}
                      >
                        {!s.requiredByJobIds.includes(j.jobId) ? "—" : s.known ? "有" : "缺"}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.68rem] text-muted">
          <span className="inline-flex items-center gap-1">
            <span className="tag cell-yes">有</span> 你已具备
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="tag cell-no">缺</span> 待补齐
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="tag cell-na">—</span> 该岗位不要求
          </span>
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <button onClick={onBack} className="btn btn-ghost flex-1">
          换一个岗位
        </button>
        <button onClick={onNext} className="btn btn-primary flex-1">
          生成下一步行动
        </button>
      </div>
    </section>
  );
}
