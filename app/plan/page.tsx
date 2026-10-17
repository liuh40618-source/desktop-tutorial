"use client";

/**
 * 职途 · 经历与技能规划，保留既有草稿与规划记录。
 */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Compass, FolderOpen, Search, Sparkles } from "lucide-react";
import { CareerChoices } from "@/components/CareerChoices";
import {
  rankJobs,
  buildPath,
  buildJdPath,
  buildGapMap,
  buildGapMapForMatches,
  matchSavedJd,
  allSkills,
  jobIds,
  DATA_META,
  initKB,
  type JobMatch,
} from "@/lib/matcher";
import { compilePlan } from "@/lib/compilePlan";
import {
  initializeGuestCache,
  loadJdsFromServer,
  loadPlansFromServer,
  loadProfileFromServer,
  PLANS_KEY,
  pushJdToServer,
  pushPlanToServer,
  pushProfileToServer,
  removeJdOnServer,
  removePlanOnServer,
  scopedStorageKey,
  STORAGE_KEY,
  type ProfileSaveResult,
} from "@/lib/plan-storage";
import { ExperienceInput } from "@/components/ExperienceInput";
import { SkillTranslation } from "@/components/SkillTranslation";
import { Orientation } from "@/components/Orientation";
import { OpeningGate, type OpeningBasics } from "@/components/OpeningGate";
import { DomainBrief } from "@/components/DomainBrief";
import { JobList } from "@/components/JobList";
import { GapView } from "@/components/GapView";
import { PathView } from "@/components/PathView";
import { Records } from "@/components/Records";
import { TrialLab } from "@/components/TrialLab";
import {
  emptyProfile,
  DEMO_PROFILE,
  type Persisted,
  type PlanRecord,
  type JdFront,
  type Profile,
  type OrientationResult,
  type WorkTag,
} from "@/lib/types";
import type { OrientationKB } from "@/lib/orientation";

/* 开场定位所需的 /api/knowledge 载荷子集（避免在客户端引入服务端模块类型） */
interface KbOption { id: string; tag: string; label: string; reason: string }
interface KbStarterItem { id: string; label: string; skillIds: string[] }
interface KbJob {
  id: string;
  title: string;
  track: string;
  workTags?: WorkTag[];
  core?: { s: string; w: number }[];
  verified_at?: string;
  sample_size?: number;
  confidence?: string;
}
interface KbTrack {
  id: string;
  name: string;
  oneLiner?: string;
  subDirections?: string[];
  glossary?: { term: string; plain: string }[];
  entryCycle?: string;
  hardThresholds?: string[];
  dataNote?: string;
  verifiedAt?: string;
  sampleSize?: number;
  confidence?: string;
}
interface KbPayload {
  jobs: KbJob[];
  tracks: KbTrack[];
  exclusions?: { contentOptions?: KbOption[]; contextOptions?: KbOption[] };
  starterSkills?: { items?: KbStarterItem[] };
  deliverableTypes?: { types?: Record<string, { label?: string; requiredElements?: string[] }> };
}

/** 跳过定位时写入的「未采用」结果：不排除任何方向，直接进原 step 0 */
const SKIPPED_ORIENTATION: OrientationResult = {
  contentExcluded: [],
  contextExcluded: [],
  excludedJobIds: [],
  excludedJobs: [],
  excludedTrackIds: [],
  partialTrackIds: [],
  candidates: [],
  excludedReasons: [],
  contextExclusionApplied: false,
  skipped: true,
  completedAt: 0,
};

export default function Home() {
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [view, setView] = useState<"flow" | "records" | "library" | "trials" | "brief">("flow");
  const [resumeStep, setResumeStep] = useState(0);
  const [emptyCheck, setEmptyCheck] = useState(false);
  const [demo, setDemo] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [profile, setProfile] = useState(emptyProfile);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [jds, setJds] = useState<JdFront[]>([]);
  const [jdsLoaded, setJdsLoaded] = useState(false);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [profileSaveState, setProfileSaveState] = useState<ProfileSaveResult | "idle" | "saving">("idle");
  const [clearingGuestData, setClearingGuestData] = useState(false);
  const handleNotice = (msg: string, kind: "error" | "info") =>
    kind === "error" ? setError(msg) : setInfo(msg);

  useEffect(() => {
    if (!error && !info) return;
    const t = setTimeout(() => {
      setError(null);
      setInfo(null);
    }, 3800);
    return () => clearTimeout(t);
  }, [error, info]);

  const [ready, setReady] = useState(false);
  const [cacheScope, setCacheScope] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const sessionBootstrapRef = useRef<Promise<{ cacheScope: string; migrateLegacyCache: boolean }> | null>(null);

  // ===== 开场定位（独立前置门，不占用 step 0–4）=====
  const [kbData, setKbData] = useState<KbPayload | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [gateResult, setGateResult] = useState<OrientationResult | null>(null);
  const [gateBasics, setGateBasics] = useState<OpeningBasics | null>(null);
  const [briefTrackId, setBriefTrackId] = useState("");
  const orientationKB = useMemo<OrientationKB | null>(
    () =>
      kbData
        ? {
            jobs: kbData.jobs,
            tracks: kbData.tracks.map((t) => ({ id: t.id, name: t.name })),
            contentOptions: kbData.exclusions?.contentOptions ?? [],
            contextOptions: kbData.exclusions?.contextOptions ?? [],
            starterSkills: kbData.starterSkills?.items ?? [],
          }
        : null,
    [kbData]
  );
  // 老草稿（有草稿或已有 orientation）直接进原 step 0，不显示开场门。
  // 必须等 profileLoaded 为 true 再判断 hasDraft/orientation，否则服务端草稿拉回之前
  // 会短暂误判为"新用户"，让老用户看到开场门闪一下（加载完成后才消失）。
  const showOpeningGate =
    view === "flow" &&
    step === 0 &&
    !!orientationKB &&
    profileLoaded &&
    !demo &&
    (gateOpen || (!started && !hasDraft && !profile.orientation));
  const briefTrack = useMemo(() => {
    const track = kbData?.tracks.find((t) => t.id === briefTrackId);
    if (!track) return null;
    return {
      id: track.id,
      name: track.name,
      oneLiner: track.oneLiner ?? "",
      subDirections: track.subDirections ?? [],
      glossary: track.glossary ?? [],
      entryCycle: track.entryCycle ?? "",
      hardThresholds: track.hardThresholds ?? [],
      dataNote: track.dataNote ?? "",
      verifiedAt: track.verifiedAt ?? "",
      sampleSize: track.sampleSize ?? 0,
      confidence: track.confidence ?? "",
    };
  }, [kbData, briefTrackId]);
  // 目标岗位的数据时效（供 GapView 展示口径标注；真实 JD 无模板时效）
  const selectedJobMeta = useMemo(() => {
    if (!selectedJobId || selectedJobId.startsWith("jd:")) return undefined;
    const job = kbData?.jobs.find((x) => x.id === selectedJobId);
    if (!job) return undefined;
    return { verifiedAt: job.verified_at, sampleSize: job.sample_size, confidence: job.confidence };
  }, [kbData, selectedJobId]);

  const effective = profile;
  const matches = useMemo(() => ready ? rankJobs(effective, jobIds().size) : [], [effective, ready]);

  const selectedJd = useMemo(
    () => selectedJobId.startsWith("jd:") ? jds.find((jd) => `jd:${jd.id}` === selectedJobId) ?? null : null,
    [jds, selectedJobId]
  );

  // 必须明确选出一个方向或真实 JD 后才有"目标岗位"；不自动代入排名第一项。
  const activeMatch: JobMatch | null = useMemo(() => {
    if (!selectedJobId) return null;
    if (selectedJobId.startsWith("jd:")) return selectedJd ? matchSavedJd(effective, selectedJd) : null;
    return matches.find((m) => m.jobId === selectedJobId) || null;
  }, [effective, matches, selectedJd, selectedJobId]);

  const gapMap = useMemo(
    () =>
      activeMatch
        ? activeMatch.source === "jd"
          ? buildGapMapForMatches(effective, [activeMatch, ...matches.slice(0, 3)])
          : buildGapMap(effective, [activeMatch.jobId, ...matches.slice(0, 4).map((m) => m.jobId).filter((id) => id !== activeMatch.jobId)])
        : { jobs: [], skills: [] },
    [effective, activeMatch, matches]
  );
  const path = useMemo(
    () => activeMatch ? activeMatch.source === "jd" && selectedJd ? buildJdPath(effective, selectedJd) : buildPath(effective, activeMatch.jobId) : [],
    [effective, activeMatch, selectedJd]
  );

  // 从内部数据接口取知识库（来自 SQLite，非 LLM），注入算法层后再放行 UI
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        let bootstrapPromise = sessionBootstrapRef.current;
        if (!bootstrapPromise) {
          bootstrapPromise = (async () => {
            const sessionResponse = await fetch("/api/session", { method: "POST", cache: "no-store" });
            if (!sessionResponse.ok) throw new Error("访客会话初始化失败");
            const session = (await sessionResponse.json()) as {
              cacheScope?: unknown;
              migrateLegacyCache?: unknown;
            };
            if (typeof session.cacheScope !== "string" || !/^[A-Za-z0-9_-]{24}$/.test(session.cacheScope)) {
              throw new Error("访客本地存储分区初始化失败");
            }
            return {
              cacheScope: session.cacheScope,
              migrateLegacyCache: session.migrateLegacyCache === true,
            };
          })();
          sessionBootstrapRef.current = bootstrapPromise;
        }
        const session = await bootstrapPromise;
        if (!alive) return;
        initializeGuestCache(session.cacheScope, session.migrateLegacyCache);
        setCacheScope(session.cacheScope);

        const knowledgeResponse = await fetch("/api/knowledge");
        if (!knowledgeResponse.ok) throw new Error("知识库读取失败");
        const kb = await knowledgeResponse.json();
        if (!alive) return;
        initKB(kb);
        setKbData(kb as KbPayload);
        setReady(true);
      } catch {
        if (alive) setLoadError(true);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);

  // 用户做出"继续 / 重新开始"决定后，才允许持久化，避免覆盖未采用的草稿
  const [restored, setRestored] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileSaveRevision = useRef(0);
  const profileSavePromise = useRef<Promise<ProfileSaveResult> | null>(null);

  const queueProfileSave = useCallback((snapshot: Persisted, scope: string): Promise<ProfileSaveResult> => {
    const previousSave = profileSavePromise.current;
    const nextSave = (previousSave ?? Promise.resolve("server" as ProfileSaveResult))
      .catch(() => "failed" as ProfileSaveResult)
      .then(() => pushProfileToServer(snapshot, scope));
    profileSavePromise.current = nextSave;
    return nextSave;
  }, []);

  useEffect(() => {
    if (!restored || demo || !cacheScope || clearingGuestData) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const snapshot: Persisted = { step, started, profile, selectedJobId };
    const revision = ++profileSaveRevision.current;
    saveTimer.current = setTimeout(() => {
      setProfileSaveState("saving");
      void queueProfileSave(snapshot, cacheScope).then((result) => {
        if (revision === profileSaveRevision.current) setProfileSaveState(result);
      });
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [restored, step, started, profile, selectedJobId, demo, cacheScope, clearingGuestData, queueProfileSave]);

  // 首次加载后从服务端拉一次草稿，提示给用户
  const personalRef = useRef<Persisted | null>(null);
  useEffect(() => {
    if (!ready || !cacheScope) return;
    let alive = true;
    loadProfileFromServer(cacheScope).then((s) => {
      if (!alive) return;
      if (s && s.profile && s.started) {
        setProfile({ ...emptyProfile, ...s.profile, knownSkillIds: [...new Set([...(s.profile.knownSkillIds || []), ...(s.doneSkills || [])])] });
        setSelectedJobId(s.selectedJobId ?? "");
        setResumeStep(Math.max(0, Math.min(4, s.step ?? 0)));
        setHasDraft(true);
      }
      setProfileLoaded(true);
    });
    return () => { alive = false; };
  }, [ready, cacheScope]);

  // 未配置 ADMIN_TOKEN 时，生产环境 /admin 会跳回本页并带 admin=off；这里如实告知，避免用户以为页面出错
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("admin") !== "off") return;
    setInfo("管理后台未启用：本演示未配置 ADMIN_TOKEN，数据维护入口已关闭。");
    params.delete("admin");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);
  function updateProfile(next: Profile) {
    setProfile(next);
    setStarted(true);
    setRestored(true);
    setHasDraft(false);
  }

  function startDemo() {
    if (demo) return;
    personalRef.current = { step: hasDraft ? resumeStep : step, started: started || hasDraft, profile, selectedJobId };
    setDemo(true);
    setView("flow");
    setProfile(DEMO_PROFILE);
    setStep(0);
    setSelectedJobId("");
    setStarted(true);
    setRestored(true);
    setHasDraft(false);
  }

  function exitDemo() {
    const saved = personalRef.current;
    setProfile(saved?.profile ?? emptyProfile);
    setStep(0);
    setResumeStep(saved?.step ?? 0);
    setHasDraft(saved?.started ?? false);
    setSelectedJobId(saved?.selectedJobId ?? "");
    setStarted(saved?.started ?? false);
    setRestored(false);
    setDemo(false);
    setView("flow");
  }

  // JD 收藏
  useEffect(() => {
    if (!ready) return;
    loadJdsFromServer().then((rows) => { setJds(rows); setJdsLoaded(true); });
  }, [ready]);

  async function saveJd(title: string, raw: string, parsed: JdFront) {
    const jd: JdFront = {
      id: parsed.id,
      title: parsed.title || title || "未命名 JD",
      raw: parsed.raw || raw,
      skills: parsed.skills,
      createdAt: parsed.createdAt,
    };
    try {
      await pushJdToServer(jd);
      setJds((list) => [jd, ...list.filter((item) => item.id !== jd.id)].slice(0, 30));
      handleNotice("已加入我的 JD", "info");
    } catch (e) {
      handleNotice(e instanceof Error ? e.message : "保存 JD 失败，请重试。", "error");
      throw e;
    }
  }

  async function removeJd(id: string) {
    try {
      await removeJdOnServer(id);
      setJds((list) => list.filter((x) => x.id !== id));
      if (selectedJobId === `jd:${id}`) {
        setSelectedJobId("");
        setStep(2);
        setView("flow");
        setRestored(true);
        handleNotice("当前目标 JD 已删除，请重新选择方向或岗位。", "info");
      }
    } catch (e) {
      handleNotice(e instanceof Error ? e.message : "删除失败，请重试。", "error");
    }
  }

  // 规划保存
  async function savePlan() {
    if (!activeMatch || !cacheScope) return;
    // 「申请复核」在零 LLM 下 = 待线下确认的个人待办；写进记录，让它在「我的记录」可见
    const reviewRequests = Object.values(profile.actionEvaluations ?? {}).filter((e) => e.reviewRequested);
    const reviewSection = reviewRequests.length
      ? `\n\n## 申请复核（待线下确认）\n${reviewRequests
          .map(
            (e) =>
              `- ${e.artifactTitle || e.actionId}：${e.reviewReason || "（未填理由）"}（最终等级 ${e.finalLevel}，规则建议 ${e.suggestedLevel}）`
          )
          .join("\n")}`
      : "";
    const rec: PlanRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      major: profile.major,
      jobTitle: activeMatch.title,
      summary: `${activeMatch.source === "jd" ? "真实 JD 技能覆盖" : "匹配分"} ${activeMatch.score}${activeMatch.source === "jd" ? "%" : " 分"} · 行动估算 ${path.reduce((sum, item) => sum + item.estHours, 0)}h${reviewRequests.length ? ` · ${reviewRequests.length} 项申请复核待线下确认` : ""}`,
      markdown: compilePlan(effective, activeMatch, path) + reviewSection,
    };
    await pushPlanToServer(rec, cacheScope);
    setInfo("规划已保存");
    setPlans((list) => [rec, ...list.filter((p) => p.id !== rec.id)]);
    if (effective.tempSkillIds?.length) {
      const rem = new Set(effective.tempSkillIds);
      setProfile((p) => ({
        ...p,
        knownSkillIds: p.knownSkillIds.filter((id) => !rem.has(id)),
        tempSkillIds: [],
      }));
      handleNotice(
        `已自动移除 ${effective.tempSkillIds.length} 项临时技能（本次规划已保存）；下次要用可回「核对经历」第 2 步重新添加`,
        "info"
      );
    }
  }

  async function deletePlan(id: string) {
    if (!cacheScope) return;
    try {
      await removePlanOnServer(id, cacheScope);
      setPlans((list) => list.filter((p) => p.id !== id));
    } catch (e) { handleNotice(e instanceof Error ? e.message : "删除失败，请重试。", "error"); }
  }

  async function renamePlan(id: string, name: string) {
    if (!cacheScope) return;
    const target = plans.find((p) => p.id === id);
    if (!target) return;
    try {
      await pushPlanToServer({ ...target, name }, cacheScope);
      setPlans((list) => list.map((p) => (p.id === id ? { ...p, name } : p)));
    } catch (e) { handleNotice(e instanceof Error ? e.message : "重命名失败，请重试。", "error"); }
  }

  async function retryProfileSave() {
    if (!cacheScope || !restored || demo || clearingGuestData) return;
    const revision = ++profileSaveRevision.current;
    const snapshot: Persisted = { step, started, profile, selectedJobId };
    setProfileSaveState("saving");
    const result = await queueProfileSave(snapshot, cacheScope);
    if (revision === profileSaveRevision.current) setProfileSaveState(result);
  }

  async function clearAllGuestData() {
    if (!cacheScope || clearingGuestData) return;
    setClearingGuestData(true);
    ++profileSaveRevision.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      await profileSavePromise.current?.catch(() => "failed" as ProfileSaveResult);
      const response = await fetch("/api/data", { method: "DELETE", cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "数据未能全部清除，请重试。");
      }

      let browserCacheCleared = true;
      for (const key of [STORAGE_KEY, PLANS_KEY]) {
        try {
          localStorage.removeItem(scopedStorageKey(key, cacheScope));
        } catch {
          browserCacheCleared = false;
        }
      }
      personalRef.current = null;
      setProfile(emptyProfile);
      setStep(0);
      setResumeStep(0);
      setStarted(false);
      setRestored(false);
      setHasDraft(false);
      setSelectedJobId("");
      setJds([]);
      setPlans([]);
      setView("flow");
      setEmptyCheck(false);
      setProfileSaveState("idle");
      profileSavePromise.current = null;
      handleNotice(
        browserCacheCleared
          ? "已清除当前访客的服务端数据与浏览器缓存。"
          : "服务端数据已清除，但浏览器缓存无法访问；请在浏览器设置中清理本站数据。",
        browserCacheCleared ? "info" : "error"
      );
    } catch (e) {
      handleNotice(e instanceof Error ? e.message : "清除数据失败，请重试。", "error");
    } finally {
      setClearingGuestData(false);
    }
  }

  if (!ready || !profileLoaded || (selectedJobId.startsWith("jd:") && !jdsLoaded)) {
    return (
      <main className="app-shell grid min-h-screen place-items-center px-4">
        <div className="text-center">
          <div className="text-lg font-semibold tracking-tight text-foreground">
            <span>职途</span>
          </div>
          <div className="mt-2 text-sm text-muted">{loadError ? "知识库暂时无法加载，请检查服务连接。" : "正在载入岗位知识库…"}</div>
          {loadError && <button className="btn btn-primary mt-4" onClick={() => window.location.reload()}>重新加载</button>}
        </div>
      </main>
    );
  }

  function navigate(next: number, jobId?: string) {
    if (jobId) setSelectedJobId(jobId);
    setEmptyCheck(false);
    setStep(next);
    setStarted(true);
    setRestored(true);
    setView("flow");
    setHasDraft(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  /** 把开场定位结果与第 3 步基础写进画像（orientation 随 profile JSON 持久化，不改 user_profile 表结构） */
  function persistOrientation(result: OrientationResult, basics: OpeningBasics) {
    const mapped = (kbData?.starterSkills?.items ?? [])
      .filter((item) => basics.skillItemIds.includes(item.id))
      .flatMap((item) => item.skillIds);
    setProfile((p) => {
      const known = new Set(p.knownSkillIds);
      const evidence = { ...p.evidenceLevels };
      for (const id of mapped) {
        known.add(id);
        if (evidence[id] === undefined) evidence[id] = 2; // 默认「课程或练习（等级 2）」，自评可调
      }
      return {
        ...p,
        major: basics.major || p.major,
        experienceType: basics.experienceType || p.experienceType,
        hoursPerWeek: basics.hoursPerWeek || p.hoursPerWeek,
        knownSkillIds: [...known],
        evidenceLevels: evidence,
        orientation: result,
      };
    });
    setStarted(true);
    setRestored(true);
    setHasDraft(false);
  }

  function handleGateComplete(result: OrientationResult, basics: OpeningBasics) {
    setGateResult(result);
    setGateBasics(basics);
    persistOrientation(result, basics);
    setGateOpen(false);
  }

  function handleGateOpenBrief(trackId: string, result: OrientationResult, basics: OpeningBasics) {
    setGateResult(result);
    setGateBasics(basics);
    persistOrientation(result, basics);
    setBriefTrackId(trackId);
    setGateOpen(false);
    setView("brief");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  /** 跳过定位：写入 skipped=true 并直接进原 step 0；不影响任何原流程断言 */
  function handleGateSkip() {
    setProfile((p) => ({ ...p, orientation: { ...SKIPPED_ORIENTATION, completedAt: Date.now() } }));
    setStarted(true);
    setRestored(true);
    setHasDraft(false);
    setGateOpen(false);
    setView("flow");
  }

  const chapter = step < 2 ? 0 : step < 4 ? 1 : 2;
  const needsSkillsForTarget = !!selectedJobId && !selectedJobId.startsWith("jd:") && !profile.knownSkillIds.length;
  return (
    <div className="trial-app">
      <header className="trial-header">
        <button className="trial-brand" onClick={() => navigate(0)} aria-label="职途，返回经历"><Compass size={26} /><strong>职途</strong><span>职业试选</span></button>
        <nav aria-label="辅助导航"><button className="quiet-button" onClick={() => setView("trials")}><Sparkles size={16} /><span>职业试驾</span></button><button className="quiet-button" onClick={() => setView("library")}><Search size={16} /><span>岗位库</span></button><button className="quiet-button" onClick={async () => { if (!cacheScope) return; setPlans(await loadPlansFromServer(cacheScope)); setView("records"); }}><FolderOpen size={16} /><span>我的记录</span></button></nav>
      </header>
      <main className={`trial-main ${step === 0 && view === "flow" ? "entry-main" : ""}`}>
      {demo && <div className="demo-ribbon"><span>示例体验 · 不覆盖个人草稿</span><button onClick={exitDemo}>返回我的经历 <ArrowUpRight size={14} /></button></div>}
      {view === "brief" ? null : view === "flow" ? (showOpeningGate ? null : <nav className="chapter-nav" aria-label="试选过程">{["看见经历", "比较选择", "动手验证"].map((label, i) => <button key={label} aria-current={chapter === i ? "step" : undefined} onClick={() => navigate(i === 0 ? 0 : i === 1 ? 2 : 4)}><span>0{i + 1}</span>{label}</button>)}</nav>) : <button className="quiet-button return-flow" onClick={() => setView("flow")}><ArrowLeft size={16} />返回试选</button>}

      {(error || info) && (
        <div
          role="alert"
          aria-live="assertive"
          className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4"
        >
          <div
            className={
              "toast-in pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm shadow-md " +
              (error ? "alert-error" : "toast-info")
            }
          >
            {error || info}
          </div>
        </div>
      )}

      {view === "trials" ? (
        <TrialLab
          attempts={profile.trialAttempts ?? []}
          onChange={(trialAttempts) => updateProfile({ ...profile, trialAttempts })}
          onBack={() => setView("flow")}
          onContinuePlanner={() => navigate(0)}
        />
      ) : view === "records" ? (
        <Records
          plans={plans}
          onBack={() => setView("flow")}
          onRename={renamePlan}
          onDelete={deletePlan}
          onClearAll={clearAllGuestData}
        />
      ) : view === "library" ? (
        <section className="library-page"><JobList matches={matches} selectedId={selectedJobId} selectedGoalId={selectedJobId} targetTracks={effective.targetTracks} jds={jds} knownSkillIds={effective.knownSkillIds} hoursPerWeek={effective.hoursPerWeek} skillOptions={allSkills().map(({ id, name }) => ({ id, name }))} onAddJd={saveJd} onDeleteJd={removeJd} onSelect={(id) => navigate(3, id)} onSelectJd={(id) => navigate(3, `jd:${id}`)} onBack={() => setView("flow")} /><details className="reason-disclosure"><summary>查看各方向的模板分布</summary><Orientation profile={effective} matches={matches} embedded onBack={() => navigate(1)} onNext={() => navigate(2)} /></details></section>
      ) : view === "brief" && briefTrack ? (
        <DomainBrief
          track={briefTrack}
          onBackToResult={() => {
            setGateOpen(true);
            setView("flow");
            window.scrollTo({ top: 0, behavior: "instant" });
          }}
          onStartExperience={() => {
            setView("flow");
            navigate(0);
          }}
        />
      ) : (
        <>

          {showOpeningGate ? (
            <OpeningGate
              kb={orientationKB as OrientationKB}
              initialResult={gateResult}
              initialBasics={gateBasics}
              onComplete={handleGateComplete}
              onSkip={handleGateSkip}
              onOpenBrief={handleGateOpenBrief}
            />
          ) : emptyCheck ? (
            <section className="trial-empty">
              <span className="chapter-label">01 / 直接核对能力</span>
              <h1>基于你现在的情况，还没有可核对的内容</h1>
              <p>
                「直接核对能力」是基于你当前记录来判断的。你还没写下任何经历，暂没有原文能逐条核对该不该写成能力。
                先如实写下做过的事，系统再陪你去对——只建议、不替你去夸。
              </p>
              <div className="trial-actions">
                <button className="btn btn-primary" onClick={() => navigate(0)}>
                  先去记录经历 <ArrowRight size={17} />
                </button>
              </div>
            </section>
          ) : (
            <>

          {step === 0 && (
            <ExperienceInput
              key={demo ? "demo" : "self"}
              profile={effective}
              setProfile={updateProfile}
              onNext={() => navigate(1)}
              onEmptyCheck={() =>
                (profile.experiences ?? "").trim() ? navigate(1) : setEmptyCheck(true)
              }
              onDemo={demo ? undefined : startDemo}
              onResume={hasDraft && resumeStep > 0 ? () => navigate(resumeStep) : undefined}
              onTrial={() => setView("trials")}
              onBrowseJobs={() => setView("library")}
            />
          )}

          {step === 1 && (
            <SkillTranslation
              profile={effective}
              setProfile={updateProfile}
              setError={setError}
              onNotice={handleNotice}
              onNext={() => navigate(2)}
            />
          )}

          {step === 2 && (
            profile.knownSkillIds.length ? (
              <CareerChoices profile={profile} matches={matches} onSelect={(id) => navigate(3, id)} onBrowse={() => setView("library")} onBack={() => navigate(1)} />
            ) : (
              <section className="trial-empty">
                <span className="chapter-label">02 / 比较选择</span>
                <h1>先完成经历与能力确认</h1>
                <p>
                  这里本该按你的能力比较岗位、挑一个值得试的方向。但你现在还没有确认任何能力：
                  得先在「看见经历」如实写下做过的事，并在「核对经历」确认哪些是你的能力，才能开始比较岗位。
                </p>
                <div className="trial-actions">
                  <button className="btn btn-primary" onClick={() => navigate(0)}>
                    去记录经历 <ArrowRight size={17} />
                  </button>
                </div>
              </section>
            )
          )}

          {step >= 3 && (!selectedJobId || needsSkillsForTarget) && (
            <section className="trial-empty">
              <span className="chapter-label">03 / 动手验证</span>
              <h1>先确认能力与目标岗位，再生成行动计划</h1>
              <p>
                行动计划要建立在被验证过的能力和一个明确的目标岗位上。当前{" "}
                {profile.knownSkillIds.length ? "还缺一个明确的岗位方向" : "还没确认任何能力"}
                ，先补好前置条件，再来对照差距、排行动计划。
              </p>
              <div className="trial-actions">
                <button className="btn btn-primary" onClick={() => navigate(profile.knownSkillIds.length ? 2 : 0)}>
                  {profile.knownSkillIds.length ? "先去选择目标岗位" : "先去记录经历"} <ArrowRight size={17} />
                </button>
              </div>
            </section>
          )}

          {step >= 3 && selectedJobId && !activeMatch && !needsSkillsForTarget && (
            <section className="trial-empty">
              <span className="chapter-label">03 / 动手验证</span>
              <h1>当前目标岗位不可用</h1>
              <p>这条真实 JD 可能已删除，或服务暂时无法读取。回到岗位库重新选择目标，再继续看差距和行动计划。</p>
              <div className="trial-actions">
                <button className="btn btn-primary" onClick={() => setView("library")}>返回岗位库 <ArrowRight size={17} /></button>
              </div>
            </section>
          )}

          {step === 3 && selectedJobId && activeMatch && (
            <GapView
              match={activeMatch}
              gapMap={gapMap}
              evidenceLevels={effective.evidenceLevels}
              sourceText={selectedJd?.raw}
              jobMeta={selectedJobMeta}
              onBack={() => activeMatch.source === "jd" ? setView("library") : navigate(2)}
              onNext={() => navigate(4)}
            />
          )}

          {step === 4 && selectedJobId && activeMatch && (
            <PathView
              key={activeMatch.jobId}
              match={activeMatch}
              path={path}
              hoursPerWeek={effective.hoursPerWeek}
              profile={effective}
              setProfile={setProfile}
              deliverableTypes={kbData?.deliverableTypes?.types}
              onSave={savePlan}
              completedActions={profile.completedActions ?? []}
              onToggleAction={(id) => setProfile((p) => ({ ...p, completedActions: (p.completedActions ?? []).includes(id) ? (p.completedActions ?? []).filter((x) => x !== id) : [...(p.completedActions ?? []), id] }))}
              actionReviews={profile.actionReviews ?? {}}
              onUpdateActionReview={(id, review) => setProfile((p) => ({ ...p, actionReviews: { ...(p.actionReviews ?? {}), [id]: review } }))}
              onCompareDirections={() => navigate(2)}
              onGoRecords={async () => {
                if (!cacheScope) return;
                const list = await loadPlansFromServer(cacheScope);
                setPlans(list);
                setView("records");
              }}
              onBack={() => navigate(3)}
            />
          )}
            </>
            )}
        </>
      )}

      {restored && !demo && profileSaveState !== "idle" && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-[var(--surface)] px-4 py-2 text-xs text-muted shadow-md"
        >
          {profileSaveState === "saving" && "正在保存草稿…"}
          {profileSaveState === "server" && "已同步到当前访客档案"}
          {profileSaveState === "local" && "仅保存在当前浏览器，尚未同步到服务端"}
          {profileSaveState === "failed" && "服务端与浏览器存储均未能保存"}
          {(profileSaveState === "local" || profileSaveState === "failed") && (
            <button className="underline underline-offset-2" onClick={() => void retryProfileSave()}>重试</button>
          )}
        </div>
      )}

      </main><footer className="trial-footer"><span>职途 / 从做过的事，到值得试的路</span><div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/submit">参赛提交中心 <ArrowUpRight size={13} /></Link>
        <Link href="/market">模板 v{DATA_META.version} · 数据与边界 <ArrowUpRight size={13} /></Link>
      </div></footer>
    </div>
  );
}
