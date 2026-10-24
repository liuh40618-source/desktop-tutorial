"use client";

/**
 * Step 2 · 找岗位
 * 真实 JD 与内置岗位并列，每张岗位卡可展开「依据」查看分数构成与逐条理由
 */
import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { matchJdSkills, type JobMatch } from "@/lib/matcher";
import { resolveUrl } from "@/lib/links";
import { fmtWeeks, type JdFront } from "@/lib/types";

interface ParsedJd {
  id: string;
  title: string;
  raw: string;
  skills: string[];
  skillSources?: { id: string; name: string; matchedAliases: string[]; negatedAliases?: string[]; uncertainAliases?: string[]; method: "rule" }[];
  manuallyAddedSkillIds?: string[];
  createdAt: number;
  meta?: { method: "rule"; truncated: boolean; normalizedChars: number };
}

function fmtScore(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function ScoreBreakdown({
  match,
}: {
  match: JobMatch;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">匹配依据</span>
        <span className="num text-xs text-foreground">余弦 {fmtScore(match.cosineSimilarity * 100)}%</span>
      </div>
      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-muted">余弦相似度用作主排序指标；方向偏好不修改技能相似度，结果不是录用概率。</p>
      <div className="mt-1 text-xs">
        <div className="flex items-center justify-between border-b border-border/60 py-1.5"><span>核心命中 / 漏报</span><span className="num">{match.signalDetection.hits} / {match.signalDetection.misses}</span></div>
        <div className="flex items-center justify-between border-b border-border/60 py-1.5"><span>非核心误报</span><span className="num">{match.signalDetection.falseAlarms ?? "不适用"}</span></div>
        <div className="flex items-center justify-between py-1.5"><span>d′（模板标签区分度）</span><span className="num">{match.signalDetection.dPrime === null ? "不适用" : fmtScore(match.signalDetection.dPrime)}</span></div>
        <div className="flex items-center justify-between py-1.5"><span>判定准则 c</span><span className="num">{match.signalDetection.criterion === null ? "不适用" : fmtScore(match.signalDetection.criterion)}</span></div>
      </div>
      <p className="mt-1 text-[0.68rem] leading-relaxed text-muted">信号检测标签暂来自岗位模板的核心/非核心技能，未使用录用结果标签。</p>
    </div>
  );
}

function JdSection({
  jds,
  knownSkillIds,
  hoursPerWeek,
  skillOptions,
  selectedGoalId,
  onAdd,
  onDelete,
  onSelectJd,
}: {
  jds: JdFront[];
  knownSkillIds: string[];
  hoursPerWeek: number;
  skillOptions: { id: string; name: string }[];
  selectedGoalId: string;
  onAdd: (title: string, raw: string, parsed: ParsedJd) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSelectJd: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [raw, setRaw] = useState("");
  const [phase, setPhase] = useState<"idle" | "parsing" | "confirm">("idle");
  const [parsed, setParsed] = useState<ParsedJd | null>(null);
  const [manualSkillId, setManualSkillId] = useState("");
  const [deletingJdId, setDeletingJdId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const hours = hoursPerWeek || 10;
  const cautionSources = parsed
    ? (parsed.skillSources ?? []).filter(
        (source) =>
          parsed.skills.includes(source.id) &&
          (source.negatedAliases?.length || source.uncertainAliases?.length)
      )
    : [];

  async function submit() {
    const text = raw.trim();
    if (!text) {
      setFormError("请先粘贴 JD 正文。");
      return;
    }
    if (text.length > 30000) {
      setFormError("JD 原文不能超过 30000 个字符，请删减后再试。");
      return;
    }
    setFormError(null);
    setPhase("parsing");
    setManualSkillId("");
    try {
      const response = await fetch("/api/jds/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, raw: text }),
      });
      const data = (await response.json().catch(() => ({}))) as ParsedJd & { error?: string };
      if (!response.ok) {
        setFormError(data.error || "JD 解析失败，请稍后重试。");
        setPhase("idle");
        return;
      }
      setParsed(data);
      setPhase("confirm");
    } catch {
      setFormError("解析请求未送达，请确认本地服务已启动后重试。");
      setPhase("idle");
    }
  }

  async function confirmParsed() {
    if (!parsed) return;
    setPhase("parsing");
    try {
      await onAdd(parsed.title, parsed.raw, parsed);
      setPhase("idle");
      setShowForm(false);
      setTitle("");
      setRaw("");
      setParsed(null);
      setManualSkillId("");
    } catch {
      setFormError("保存失败，识别结果仍保留在当前页面，可以重试。");
      setPhase("confirm");
    }
  }

  if (jds.length === 0 && !showForm) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-4 py-3">
        <span className="text-xs text-muted">
          内置库未覆盖的目标岗位，可粘贴 JD 加入个人比对
        </span>
        <button
          onClick={() => setShowForm(true)}
          className="btn btn-ghost shrink-0 px-3 py-1.5 text-xs"
        >
          + 收藏真实 JD
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">
          你收藏的真实 JD{jds.length > 0 ? `（${jds.length}）` : ""}
        </h3>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-ghost shrink-0 px-3 py-1.5 text-xs"
        >
          {showForm ? "收起" : "+ 收藏一条真实 JD"}
        </button>
      </div>
      <p className="mt-0.5 text-xs text-muted">
        用于收藏内置库未覆盖的真实岗位，按此 JD 计算差距
      </p>

      {showForm && (
        <div className="card mt-3 space-y-3 p-5">
          <label className="block">
            <span className="lbl">岗位名称（给自己看的）</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input"
              placeholder="例：XX公司 数据分析师"
            />
          </label>
          <label className="block">
            <span className="lbl">粘贴完整 JD（岗位要求段落齐全识别最准）</span>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={5}
              className="input min-h-[110px] resize-y"
              placeholder="粘贴 JD 原文（含岗位职责与任职要求）"
            />
          </label>
          {formError && (
            <div role="alert" className="rounded-lg border border-red-300/50 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </div>
          )}
          {phase === "confirm" && parsed && (
            <div className="rounded-lg border border-accent/30 bg-accent-soft p-3">
              <div className="text-xs font-semibold text-foreground">识别结果（规则基线，请确认后保存）</div>
              <p className="mt-1 text-xs text-muted">逐项核对技能。规则命中可能误识别或漏识别；JD 没有说明权重时按等权处理。</p>
              {parsed.skills.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {parsed.skills.map((id) => {
                    const source = parsed.skillSources?.find((item) => item.id === id);
                    const skillName = skillOptions.find((item) => item.id === id)?.name ?? source?.name ?? id;
                    const isManual = parsed.manuallyAddedSkillIds?.includes(id);
                    return <span key={id} className="tag w1 inline-flex items-center gap-1.5" title={isManual ? "手动添加" : source ? `规则命中：${source.matchedAliases.join("、")}` : "手动添加"}>
                      {skillName}<span className="text-[0.6rem] opacity-70">{isManual ? "手动" : "规则"}</span>
                      <button type="button" aria-label={`移除${skillName}`} className="ml-0.5 font-semibold" onClick={() => setParsed({ ...parsed, skills: parsed.skills.filter((skillId) => skillId !== id) })}>×</button>
                    </span>;
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted">没有识别到技能。可手动补充；否则暂时无法用这条 JD 生成行动。</p>
              )}
              {cautionSources.length > 0 && (
                <p role="note" className="mt-2 text-xs text-amber-700">
                  以下候选附近出现了否定、学习中或经验有限等表述：
                  {cautionSources
                    .map(
                      (source) =>
                        `${source.name}（${[
                          ...(source.negatedAliases ?? []),
                          ...(source.uncertainAliases ?? []),
                        ].join("、")}）`
                    )
                    .join("；")}
                  。规则仍把它们列为候选，请核对原文并按需移除后再保存。
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <select className="input min-w-0 flex-1" value={manualSkillId} onChange={(e) => setManualSkillId(e.target.value)} aria-label="选择要补充的技能">
                  <option value="">补充漏识别的技能…</option>
                  {skillOptions.filter((skill) => !parsed.skills.includes(skill.id)).map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                </select>
                <button type="button" className="btn btn-ghost px-3 py-2 text-xs" disabled={!manualSkillId} onClick={() => {
                  setParsed({ ...parsed, skills: [...parsed.skills, manualSkillId], manuallyAddedSkillIds: [...new Set([...(parsed.manuallyAddedSkillIds ?? []), manualSkillId])] });
                  setManualSkillId("");
                }}>添加技能</button>
              </div>
              {parsed.meta?.truncated && <p className="mt-2 text-xs text-muted">原文较长，已截取前 20000 个字符用于识别。</p>}
            </div>
          )}
          <div className="flex gap-2">
            {phase === "confirm" ? (
              <>
                <button onClick={confirmParsed} className="btn btn-primary flex-1">
                  确认技能清单并保存
                </button>
                <button onClick={() => setPhase("idle")} className="btn btn-ghost flex-1">
                  返回修改
                </button>
              </>
            ) : (
              <>
                <button onClick={submit} className="btn btn-primary flex-1" disabled={!raw.trim() || phase === "parsing"}>
                  {phase === "parsing" ? "识别中…" : "识别 JD 技能"}
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setTitle("");
                    setRaw("");
                    setParsed(null);
                    setManualSkillId("");
                    setFormError(null);
                    setPhase("idle");
                  }}
                  className="btn btn-ghost flex-1"
                  disabled={phase === "parsing"}
                >
                  取消
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {jds.length > 0 && (
        <div className="mt-3 space-y-3">
          {jds.map((jd) => {
            const m = matchJdSkills({ knownSkillIds, hoursPerWeek: hours }, jd.skills);
            return (
              <div key={jd.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold tracking-tight text-foreground">
                        {jd.title}
                      </span>
                      <span className="tag" style={{ background: "rgba(47,107,255,.12)", color: "var(--accent-strong)" }}>
                        我的 JD
                      </span>
                      {jd.skills.length > 0 && <span className="tag w1">确认技能 {jd.skills.length} 项</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {new Date(jd.createdAt).toLocaleString("zh-CN")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-xl font-semibold tracking-tight text-accent">
                      {m.coverage}%
                    </div>
                    <div className="text-xs text-muted">JD 覆盖</div>
                  </div>
                </div>
                <div className="mt-3 track">
                  <i style={{ width: `${m.coverage}%` }} />
                </div>
                <ul className="mt-3 space-y-1 text-xs leading-relaxed text-muted">
                  {m.reasons.map((r, idx) => (
                    <li key={idx} className="flex gap-1.5">
                      <span aria-hidden className="shrink-0 text-accent">·</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
                {m.missing.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {m.missing.slice(0, 6).map((s) => (
                      <div
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs"
                      >
                        <span className="min-w-0 truncate text-foreground">
                          {s.name}
                          <span className="text-muted"> · 约 {s.estHours} 小时</span>
                        </span>
                        <span className="shrink-0 text-muted">
                          缺口 ·{" "}
                          <a className="text-accent hover:underline" target="_blank" rel="noreferrer" href={resolveUrl("B站", s.name)}>
                            去学 ↗
                          </a>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={!jd.skills.length}
                    onClick={() => onSelectJd(jd.id)}
                    className={`btn flex-1 py-2 text-xs ${selectedGoalId === `jd:${jd.id}` ? "btn-primary" : "btn-ghost"} disabled:cursor-not-allowed disabled:opacity-50`}
                    title={jd.skills.length ? "将按此 JD 的已确认技能生成差距与行动计划" : "这条 JD 没识别到库内技能，暂时无法生成行动计划"}
                  >
                    {!jd.skills.length ? "未识别到技能，无法生成计划" : selectedGoalId === `jd:${jd.id}` ? "当前目标 · 查看差距" : "以此真实 JD 生成行动"}
                  </button>
                  <button
                    onClick={async () => {
                      setDeletingJdId(jd.id);
                      try { await onDelete(jd.id); }
                      finally { setDeletingJdId(null); }
                    }}
                    disabled={deletingJdId === jd.id}
                    className="shrink-0 text-xs text-muted transition-colors hover:text-red-500 disabled:cursor-wait disabled:opacity-50"
                  >
                    {deletingJdId === jd.id ? "删除中…" : "删除"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function JobList({
  matches,
  selectedId,
  jds,
  selectedGoalId,
  knownSkillIds,
  hoursPerWeek,
  skillOptions,
  onAddJd,
  onDeleteJd,
  onSelect,
  onSelectJd,
  onBack,
}: {
  matches: JobMatch[];
  selectedId: string;
  jds: JdFront[];
  selectedGoalId: string;
  knownSkillIds: string[];
  hoursPerWeek: number;
  skillOptions: { id: string; name: string }[];
  onAddJd: (title: string, raw: string, parsed: ParsedJd) => Promise<void>;
  onDeleteJd: (id: string) => Promise<void>;
  onSelect: (id: string) => void;
  onSelectJd: (id: string) => void;
  onBack: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [trackFilter, setTrackFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "gaps" | "hard">("all");
  const [sort, setSort] = useState<"match" | "coverage" | "gap">("match");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;
  const tracks = useMemo(() => [...new Map(matches.map((match) => [match.track, { id: match.track, name: match.trackName }])).values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")), [matches]);
  const filteredMatches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const result = matches.filter((match) => {
      const searchable = [match.title, match.trackName, match.summary, ...match.covered.map((skill) => skill.name), ...match.missing.map((skill) => skill.name), ...match.plusCovered].join(" ").toLocaleLowerCase();
      const statusOk = statusFilter === "all" || (statusFilter === "ready" && match.missing.length === 0) || (statusFilter === "gaps" && match.missing.length > 0) || (statusFilter === "hard" && match.missing.some((skill) => skill.weight === 3));
      return (!needle || searchable.includes(needle)) && (trackFilter === "all" || match.track === trackFilter) && statusOk;
    });
    return result.sort((a, b) => sort === "coverage" ? b.coverage - a.coverage || b.cosineSimilarity - a.cosineSimilarity : sort === "gap" ? a.missing.length - b.missing.length || b.cosineSimilarity - a.cosineSimilarity : b.cosineSimilarity - a.cosineSimilarity || (b.signalDetection.dPrime ?? -Infinity) - (a.signalDetection.dPrime ?? -Infinity));
  }, [matches, query, sort, statusFilter, trackFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredMatches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageMatches = filteredMatches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const activeFilters = [
    query.trim() ? "关键词“" + query.trim() + "”" : "",
    trackFilter !== "all" ? tracks.find((track) => track.id === trackFilter)?.name ?? trackFilter : "",
    statusFilter === "ready" ? "技能已覆盖" : statusFilter === "gaps" ? "有技能缺口" : statusFilter === "hard" ? "有硬门槛缺口" : "",
  ].filter(Boolean);
  function clearFilters() { setQuery(""); setTrackFilter("all"); setStatusFilter("all"); setSort("match"); setPage(0); }

  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">找岗位</h2>
      <p className="mt-1 text-sm text-muted">按匹配度浏览岗位模板，可筛方向 / 技能缺口 / 排序；也可以粘贴真实 JD 做对比。</p>

      <div className="mt-4 border-y border-border py-4" aria-label="岗位库筛选器">
        <label className="relative block"><span className="sr-only">搜索岗位、方向或技能</span><Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} className="input pl-9 pr-10" placeholder="搜索岗位、方向或技能" />{query && <button type="button" aria-label="清空搜索" title="清空搜索" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-[var(--surface-2)] hover:text-foreground" onClick={() => { setQuery(""); setPage(0); }}><X size={15} aria-hidden /></button>}</label>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-muted">方向<select className="input mt-1 py-2 text-sm" value={trackFilter} onChange={(event) => { setTrackFilter(event.target.value); setPage(0); }}><option value="all">全部方向</option>{tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
          <label className="text-xs text-muted">技能缺口<select className="input mt-1 py-2 text-sm" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(0); }}><option value="all">全部岗位</option><option value="ready">技能已覆盖</option><option value="gaps">有技能缺口</option><option value="hard">有硬门槛缺口</option></select></label>
          <label className="text-xs text-muted">排序<select className="input mt-1 py-2 text-sm" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(0); }}><option value="match">余弦相似度最高</option><option value="coverage">技能覆盖最高</option><option value="gap">待补技能最少</option></select></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span role="status" aria-live="polite" className="inline-flex items-center gap-1.5"><SlidersHorizontal size={14} aria-hidden />显示 {filteredMatches.length} / {matches.length} 个岗位模板{activeFilters.length > 0 ? " · 已应用 " + activeFilters.length + " 项筛选" : ""}</span>{(query || trackFilter !== "all" || statusFilter !== "all" || sort !== "match") && <button type="button" className="quiet-button text-xs" onClick={clearFilters}>清除筛选</button>}</div>
        {activeFilters.length > 0 && <p className="mt-2 text-[0.68rem] text-muted">当前条件：{activeFilters.join(" · ")}{sort !== "match" ? " · " + (sort === "coverage" ? "按技能覆盖排序" : "按待补技能排序") : ""}</p>}
      </div>
      <JdSection
        jds={jds}
        knownSkillIds={knownSkillIds}
        hoursPerWeek={hoursPerWeek}
        skillOptions={skillOptions}
        selectedGoalId={selectedGoalId}
        onAdd={onAddJd}
        onDelete={onDeleteJd}
        onSelectJd={onSelectJd}
      />

      <div className="mt-7">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">
          内置岗位模板 · {sort === "coverage" ? "技能覆盖最高" : sort === "gap" ? "待补技能最少" : "余弦相似度最高"}
        </h3>
        {filteredMatches.length === 0 ? (
          <div className="card p-8 text-center text-sm text-muted">
            <p>{matches.length ? "没有符合当前条件的岗位模板。" : "知识库里暂无可匹配的岗位模板。"}</p>
            {matches.length > 0 && <><p className="mt-1 text-xs">可以换个关键词，或清除当前筛选后继续浏览。</p><button type="button" onClick={clearFilters} className="btn btn-ghost mt-3">清除筛选</button></>}
          </div>
        ) : (
          <div className="space-y-3">
            {pageMatches.map((m) => {
              const open = openId === m.jobId;
              const hardMissing = m.missing.filter((s) => s.weight === 3);
              return (
                <div key={m.jobId} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold tracking-tight text-foreground">
                          {m.title}
                        </span>
                        <span className="tag w1">{m.trackName}</span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{m.summary}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-xl font-semibold tracking-tight text-accent">
                        {m.coverage}%
                      </div>
                      <div className="text-xs text-muted">覆盖率</div>
                      <div className="mt-0.5 num text-xs text-muted">余弦相似度 {(m.cosineSimilarity * 100).toFixed(1)}%</div>
                    </div>
                  </div>

                  <div className="mt-3 track">
                    <i style={{ width: `${m.coverage}%` }} />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span>
                      待补齐 <b className="num text-foreground">{m.missing.length}</b> 项
                    </span>
                    <span>
                      约 <b className="num text-foreground">{m.gapHours}</b> 小时
                    </span>
                    <span>
                      按你的节奏 <b className="num text-foreground">{fmtWeeks(m.etaWeeks)}</b>
                    </span>
                    <span>
                      项目证据覆盖 {m.evidenceCoverage}%（自评）
                    </span>
                  </div>

                  {hardMissing.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted">硬门槛缺失：</span>
                      {hardMissing.map((s) => (
                        <span key={s.id} className="tag w3">
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => onSelect(m.jobId)}
                      className={`btn flex-1 py-2 text-xs ${
                        selectedId === m.jobId ? "btn-primary" : "btn-ghost"
                      }`}
                    >
                      {selectedId === m.jobId ? "已选择 · 看差距" : "选它 · 看差距"}
                    </button>
                    <button
                      onClick={() => setOpenId(open ? null : m.jobId)}
                      className="btn btn-ghost px-3 py-2 text-xs"
                    >
                      {open ? "收起" : "依据"}
                    </button>
                  </div>

                  {open && (
                    <div className="mt-3 space-y-2">
                      <div className="rounded-xl bg-[var(--surface-2)] p-3">
                        <ScoreBreakdown match={m} />
                      </div>
                      <div className="rounded-xl bg-[var(--surface-2)] p-3">
                        <div className="text-xs font-semibold text-foreground">逐条依据</div>
                        <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-muted">
                          {m.reasons.map((r, i) => (
                            <li key={i} className="flex gap-1.5">
                              <span aria-hidden className="shrink-0 text-accent">
                                ·
                              </span>
                              <span>{r}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs leading-relaxed text-muted">
                          <div>
                            <span className="text-muted">入门门槛</span>
                            <span className="mx-1">：</span>
                            {m.threshold || "—"}
                          </div>
                          <div>
                            <span className="text-muted">发展路径</span>
                            <span className="mx-1">：</span>
                            {m.growth || "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage === 0}
            className="btn btn-ghost px-3 py-1.5 text-xs"
          >
            上一批
          </button>
          <span className="text-xs text-muted">
            第 {currentPage + 1} / {pageCount} 批 · 共 {filteredMatches.length} 个岗位
          </span>
          <button
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= pageCount - 1}
            className="btn btn-ghost px-3 py-1.5 text-xs"
          >
            下一批
          </button>
        </div>
      )}

      <button onClick={onBack} className="btn btn-ghost mt-5 w-full">
        返回上一步
      </button>
    </section>
  );
}
