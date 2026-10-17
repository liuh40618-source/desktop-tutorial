"use client";

/**
 * 职业市场洞察看板
 * 纯前端聚合 /api/knowledge 数据，SVG/CSS 可视化，零 LLM、零外部依赖。
 * 5 大板块：方向分布 / 技能稀缺度 / 薪资透视 / 高需求技能 / 方向×技能热力
 */
import { useMemo, useState, useEffect } from "react";
import { allSkills, allTracks, initKB } from "@/lib/matcher";

interface SalaryBucket {
  label: string;
  min: number;
  count: number;
}

function parseSalaryRange(s: string | undefined): [number, number] | null {
  if (!s) return null;
  const m = s.match(/([0-9]+(?:\.[0-9]+)?)\s*[-–—]\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  if (isNaN(a) || isNaN(b)) return null;
  return [Math.min(a, b), Math.max(a, b)];
}

/** 按技能权重与需求频次打分的方向关键技能：core 的 w 加权 + 被引用次数 */
function trackSkillScore(
  jobsRaw: any[],
  skillName: (id: string) => string
): Array<{ track: string; skills: Array<{ name: string; w: number }> }> {
  const map = new Map<string, Map<string, number>>();
  for (const job of jobsRaw) {
    if (!job.track) continue;
    const t = map.get(job.track) ?? new Map<string, number>();
    for (const c of job.core || []) {
      if (typeof c?.s !== "string") continue;
      const w = typeof c.w === "number" ? c.w : 1;
      t.set(c.s, (t.get(c.s) ?? 0) + w);
    }
    map.set(job.track, t);
  }
  return [...map.entries()].map(([track, skillMap]) => ({
    track,
    skills: [...skillMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, w]) => ({ name: skillName(id), w })),
  }));
}

function makeSvgScale(maxValue: number, ticks = 4) {
  const step = Math.max(1, Math.ceil(maxValue / ticks));
  const out: number[] = [];
  for (let v = 0; v <= maxValue; v += step) out.push(v);
  if (out[out.length - 1] !== maxValue) out.push(maxValue);
  return out;
}

export function MarketBoard() {
  const skills = allSkills();
  const tracks = allTracks();
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of skills) m.set(s.id, s.name);
    return (id: string) => m.get(id) ?? id;
  }, [skills]);

  const data = useLocalSBData();
  const jobs = useMemo(() => (data ? (data as any)?.jobs ?? [] : []), [data]);
  const dataReady = !!data;

  // ── 板块1：方向岗位数 ──
  const trackCounts = useMemo(() => {
    if (!jobs.length) return tracks.map((t) => ({ id: t.id, name: t.name, count: 0 }));
    const m = new Map<string, number>();
    for (const j of jobs) m.set(j.track, (m.get(j.track) ?? 0) + 1);
    return tracks.map((t) => ({ id: t.id, name: t.name, count: m.get(t.id) ?? 0 }));
  }, [jobs, tracks]);
  const maxTrack = Math.max(...trackCounts.map((t) => t.count), 1);

  // ── 板块2：技能稀缺度 ──
  const scarse = useMemo(
    () =>
      skills.map((s) => ({ ...s, marketFrequency: jobs.length ? jobs.filter((j: { core: { s: string }[] }) => j.core.some((c) => c.s === s.id)).length / jobs.length : 0 }))
        .sort((a, b) => b.marketFrequency - a.marketFrequency)
        .slice(0, 12),
    [skills, jobs]
  );

  // ── 板块3：薪资透视 ──
  const salary = useMemo(() => {
    const buckets: SalaryBucket[] = [
      { label: "<5K", min: 0, count: 0 },
      { label: "5–10K", min: 5, count: 0 },
      { label: "10–15K", min: 10, count: 0 },
      { label: "15–20K", min: 15, count: 0 },
      { label: "20K+", min: 20, count: 0 },
    ];
    for (const j of jobs) {
      const r = parseSalaryRange(j.salary?.junior);
      if (!r) continue;
      const mid = (r[0] + r[1]) / 2;
      // 单位可能是 元/小时(上海)"150-250"，也可能是 K/月"10-18"。按 ÷1000 归一为 K
      const k = mid > 100 ? mid / 1000 : mid;
      const hit = [...buckets].reverse().find((b) => k >= b.min) ?? buckets[0];
      hit.count += 1;
    }
    return buckets;
  }, [jobs]);
  const maxSalary = Math.max(...salary.map((b) => b.count), 1);

  // ── 板块4：高需求技能云 ──
  const demand = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) {
      for (const c of j.core || []) {
        if (c?.s) m.set(c.s, (m.get(c.s) ?? 0) + 1);
      }
    }
    return [...m.entries()]
      .map(([id, count]) => ({ name: nameById(id), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 24);
  }, [jobs, nameById]);
  const maxDemand = Math.max(...demand.map((d) => d.count), 1);

  // ── 板块5：方向×技能热力 ──
  const heat = useMemo(() => trackSkillScore(jobs, nameById), [jobs, nameById]);
  const yTicksS = makeSvgScale(maxSalary < 4 ? 4 : maxSalary, 4);

  if (!dataReady) {
    return <div className="py-16 text-center text-sm text-muted">正在聚合岗位市场数据…</div>;
  }

  return (
    <section className="space-y-8">
      <header>
        <div className="flex items-center gap-2">
          <span className="num text-sm font-semibold tracking-tight text-accent">◦</span>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            岗位知识库观察
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted">
          基于库内 {jobs.length} 个岗位 × {skills.length} 项技能·{" "}
          <span className="text-accent-strong">零 LLM</span>，全部本地理算、可追溯
        </p>
      </header>

      {/* 板块1 方向岗位数（水平条形图） */}
      <div className="card p-5">
        <h3 className="text-[0.95rem] font-semibold text-foreground">① 岗位方向分布</h3>
        <p className="mt-0.5 text-xs text-muted">每个职业方向当前收录的岗位数量</p>
        <div className="mt-4 space-y-2">
          {trackCounts.map((t) => (
            <div key={t.id} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2">
              <span className="truncate text-right text-xs text-muted">{t.name}</span>
              <div className="h-3.5 overflow-hidden rounded bg-trackbar">
                <div
                  className="h-full rounded bg-accent transition-all duration-500"
                  style={{ width: `${(t.count / maxTrack) * 100}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-foreground">{t.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 板块2 技能稀缺度 */}
        <div className="card p-5">
          <h3 className="text-[0.95rem] font-semibold text-foreground">② 库内技能引用比例</h3>
          <p className="mt-0.5 text-xs text-muted">
            引用该技能的岗位模板数 ÷ 模板总数，不代表市场需求或人才稀缺度
          </p>
          <ul className="mt-4 space-y-2">
            {scarse.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="w-5 flex-none text-right text-xs text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.name}</span>
                <span className="flex-none text-xs font-semibold text-accent-strong">
                  {Math.round(s.marketFrequency * 100)}%
                </span>
                <div className="h-2 w-16 flex-none overflow-hidden rounded bg-trackbar">
                  <div
                    className="h-full rounded bg-accent"
                    style={{ width: `${s.marketFrequency * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* 板块3 薪资透视（SVG 条形图） */}
        <div className="card p-5">
          <h3 className="text-[0.95rem] font-semibold text-foreground">③ 初级薪资透视</h3>
          <p className="mt-0.5 text-xs text-muted">人工模板薪资参考（K/月），非实时薪资调查</p>
          <svg viewBox="0 0 320 220" className="mt-4 w-full" role="img" aria-label="初级薪资分布柱状图">
            <line x1="40" y1="8" x2="40" y2="180" stroke="var(--trackbar)" strokeWidth="1" />
            {yTicksS.map((v) => (
              <g key={v}>
                <line x1="40" y1={180 - (v / maxSalary) * 168} x2="300" y2={180 - (v / maxSalary) * 168} stroke="var(--trackbar)" strokeWidth="0.5" strokeDasharray="2 3" />
                <text x="34" y={182 - (v / maxSalary) * 168} textAnchor="end" fontSize="9" fill="var(--muted)">
                  {v}
                </text>
              </g>
            ))}
            {salary.map((b, i) => {
              const h = maxSalary ? (b.count / maxSalary) * 150 : 0;
              const x = 74 + i * 48;
              return (
                <g key={b.label}>
                  <rect x={x} y={180 - h} width="26" height={h} rx="3" fill="var(--accent)" opacity="0.9" />
                  <text x={x + 13} y={172 - h} fontSize="9" textAnchor="middle" fill="var(--foreground)" fontWeight="600">
                    {b.count}
                  </text>
                  <text x={x + 13} y="196" fontSize="8.5" textAnchor="middle" fill="var(--muted)">
                    {b.label}
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="mt-1 text-[0.7rem] text-muted">注：单位已归一为 K/月，仅供量级参考</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 板块4 高需求技能云 */}
        <div className="card p-5">
          <h3 className="text-[0.95rem] font-semibold text-foreground">④ 高需求技能云</h3>
          <p className="mt-0.5 text-xs text-muted">
            Top {demand.length} 项 · 被越多岗位列为核心要求，字号越大、颜色越深
          </p>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-3 lg:min-h-[180px]">
            {demand.map((d) => {
              const ratio = d.count / maxDemand;
              const size = 14 + ratio * 20;
              const strong = ratio > 0.75;
              const mid = ratio > 0.4;
              const wordColor = strong ? "var(--accent-strong)" : mid ? "var(--accent)" : "var(--muted)";
              return (
                <span
                  key={d.name}
                  title={`「${d.name}」被 ${d.count} / ${jobs.length} 个岗位列为硬性/核心要求`}
                  className="inline-flex items-baseline gap-1 leading-snug"
                  style={{ fontSize: `${size}px` }}
                >
                  <span style={{ color: wordColor }} className={strong ? "font-semibold" : "font-medium"}>
                    {d.name}
                  </span>
                  <span
                    className="text-[0.55em] font-normal"
                    style={{ color: mid ? "var(--accent)" : "var(--muted)" }}
                  >
                    ×{d.count}
                  </span>
                </span>
              );
            })}
          </div>
        </div>

        {/* 板块5 方向×技能热力 */}
        <div className="card p-5">
          <h3 className="text-[0.95rem] font-semibold text-foreground">⑤ 方向 × 关键技能</h3>
          <p className="mt-0.5 text-xs text-muted">各方向最看重的 Top 技能（按岗位权重求和）</p>
          <div className="mt-4 space-y-3">
            {heat.slice(0, 8).map((row) => (
              <div key={row.track} className="flex items-start gap-2">
                <span className="w-16 flex-none text-xs font-semibold text-foreground">
                  {tracks.find((t) => t.id === row.track)?.name ?? row.track}
                </span>
                <div className="flex flex-1 flex-wrap gap-1">
                  {row.skills.map((sk) => (
                    <span
                      key={sk.name}
                      className={
                        "rounded px-1.5 py-0.5 text-[0.7rem] " +
                        (sk.w > 3 ? "bg-accent-soft font-semibold text-accent-strong" : "bg-trackbar/60 text-muted")
                      }
                    >
                      {sk.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** 在纯客户端组件里拉取 /api/knowledge（与主页面共用同一数据源） */
function useLocalSBData() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((kb) => {
        if (alive) {
          initKB(kb);
          setData(kb);
        }
      })
      .catch(() => {
        /* 忽略 */
      });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}
