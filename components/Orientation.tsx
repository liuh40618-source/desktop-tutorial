"use client";

/**
 * Step 1 · 看方向
 */
import { useMemo } from "react";
import { TRACK_NAME, type JobMatch } from "@/lib/matcher";
import type { Profile } from "@/lib/types";

export function Orientation({
  profile,
  matches,
  onBack,
  onNext,
  embedded = false,
}: {
  profile: Profile;
  matches: JobMatch[];
  onBack: () => void;
  onNext: () => void;
  /** 作为子区块嵌入"匹配岗位"步骤时不渲染首尾按钮 */
  embedded?: boolean;
}) {
  // 按方向聚合：该方向下所有岗位覆盖率的平均值
  const byTrack = useMemo(() => {
    const m = new Map<string, { sum: number; n: number; best: JobMatch }>();
    for (const j of matches) {
      const cur = m.get(j.track);
      if (!cur) m.set(j.track, { sum: j.coverage, n: 1, best: j });
      else {
        cur.sum += j.coverage;
        cur.n += 1;
        if (j.coverage > cur.best.coverage) cur.best = j;
      }
    }
    return Array.from(m.entries())
      .map(([track, v]) => ({
        track,
        name: TRACK_NAME[track] || track,
        avg: Math.round(v.sum / v.n),
        best: v.best,
      }))
      .sort((a, b) => b.avg - a.avg);
  }, [matches]);

  const best = byTrack[0];

  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">方向匹配概览</h2>
      <p className="mt-1 text-sm text-muted">
        按 {byTrack.length || 0} 个方向把你勾选的 {profile.knownSkillIds.length} 项技能分组聚合，看离哪个领域最近——
        覆盖率不是能力评分，只表示「岗位要求里你会多少」
      </p>

      <div className="card mt-5 p-5">
        <div className="text-xs text-muted">当前最接近的领域</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          {best?.name || "—"}
        </div>
        <div className="mt-1 text-sm text-muted">
          平均覆盖率 {best?.avg ?? 0}% · 最强匹配岗位「{best?.best.title ?? "—"}」（{best?.best.score ?? 0} 分）
        </div>

        <div className="mt-5 space-y-3">
          {byTrack.slice(0, 5).map((t) => (
            <div key={t.track}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-foreground">{t.name}</span>
                <span className="text-muted">{t.avg}%</span>
              </div>
              <div className="track">
                <i style={{ width: `${t.avg}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card mt-4 p-5">
        <h3 className="text-base font-medium text-foreground">选方向时看什么</h3>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-muted">
          <li>
            · <b className="text-foreground">覆盖率</b>：岗位要求里你会多少，不是能力打分
          </li>
          <li>
            · <b className="text-foreground">优先补硬门槛</b>（权重 3）：通常是初筛过滤条件
          </li>
          <li>
            · <b className="text-foreground">时长为经验估算</b>，用于排序和节奏参考，不是承诺
          </li>
        </ul>
      </div>

      {!embedded && (
        <div className="mt-5 flex gap-3">
          <button onClick={onBack} className="btn btn-ghost flex-1">
            上一步
          </button>
          <button onClick={onNext} className="btn btn-primary flex-1">
            查看岗位列表
          </button>
        </div>
      )}
    </section>
  );
}
