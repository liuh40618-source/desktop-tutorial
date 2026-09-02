"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  rankJobs,
  matchJob,
  buildPath,
  buildGapMap,
  detectSkills,
  profileText,
  allSkills,
  allTracks,
  jobIds,
  SKILL_MAP,
  TRACK_NAME,
  DATA_META,
  initKB,
  type JobMatch,
  type PathItem,
} from "@/lib/matcher";
import { resolveUrl } from "@/lib/links";
import { ResumeImport } from "@/components/ResumeImport";

const STEPS = ["我的情况", "选方向", "找岗位", "查差距", "定计划"];
const STORAGE_KEY = "zhitu_state_v2";
const PLANS_KEY = "zhitu_plans_v2";
const ACTIVE_KEY = "zhitu_active_v1";

interface Profile {
  major: string;
  grade: string;
  works: string;
  certificates: string;
  selfDescription: string;
  interests: string;
  knownSkillIds: string[];
  customSkills: string[];
  /** 映射来源的「一次性临时技能」（同时存在于 knownSkillIds），保存本次规划后自动移除 */
  tempSkillIds: string[];
  targetTracks: string[];
  hoursPerWeek: number;
  goal: string;
}

const emptyProfile: Profile = {
  major: "",
  grade: "",
  works: "",
  certificates: "",
  selfDescription: "",
  interests: "",
  knownSkillIds: [],
  customSkills: [],
  tempSkillIds: [],
  targetTracks: [],
  hoursPerWeek: 10,
  goal: "",
};

interface Persisted {
  step: number;
  started: boolean;
  profile: Profile;
  selectedJobId: string;
  doneSkills: string[];
}

interface PlanRecord {
  id: string;
  createdAt: number;
  major: string;
  jobTitle: string;
  summary: string;
  markdown: string;
}

/* 服务端持久化（SQLite 为主，localStorage 仅作网络异常兜底） */
interface ProfileRowFront {
  id: string;
  name: string;
  step: number;
  started: boolean;
  profile: any;
  selectedJobId: string;
  doneSkills: string[];
  updatedAt: string;
}

async function loadProfilesFromServer(): Promise<ProfileRowFront[]> {
  try {
    const r = await fetch("/api/profile");
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function loadProfileFromServer(id: string): Promise<Persisted | null> {
  try {
    const r = await fetch(`/api/profile?id=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error("bad");
    const row = await r.json();
    if (!row) return null;
    return {
      step: row.step,
      started: row.started,
      profile: row.profile,
      selectedJobId: row.selectedJobId,
      doneSkills: row.doneSkills,
    };
  } catch {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Persisted) : null;
    } catch {
      return null;
    }
  }
}

async function pushProfileToServer(s: Persisted, id: string, name: string) {
  try {
    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, ...s }),
    });
    return;
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* 忽略 */
    }
  }
}

async function deleteProfileOnServer(id: string) {
  try {
    await fetch(`/api/profile?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* 忽略 */
  }
}

async function loadPlansFromServer(): Promise<PlanRecord[]> {
  try {
    const r = await fetch("/api/plans");
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    try {
      const raw = localStorage.getItem(PLANS_KEY);
      return raw ? (JSON.parse(raw) as PlanRecord[]) : [];
    } catch {
      return [];
    }
  }
}

async function pushPlanToServer(rec: PlanRecord) {
  try {
    await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rec),
    });
  } catch {
    try {
      const list = JSON.parse(localStorage.getItem(PLANS_KEY) || "[]") as PlanRecord[];
      localStorage.setItem(
        PLANS_KEY,
        JSON.stringify([rec, ...list.filter((p) => p.id !== rec.id)].slice(0, 50))
      );
    } catch {
      /* 忽略 */
    }
  }
}

async function removePlanOnServer(id: string) {
  try {
    await fetch(`/api/plans?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    try {
      const list = JSON.parse(localStorage.getItem(PLANS_KEY) || "[]") as PlanRecord[];
      localStorage.setItem(PLANS_KEY, JSON.stringify(list.filter((p) => p.id !== id)));
    } catch {
      /* 忽略 */
    }
  }
}

function fmtWeeks(w: number): string {
  if (w <= 0) return "已达成";
  if (w < 1) return "不到 1 周";
  if (w < 8) return `约 ${Math.round(w)} 周`;
  return `约 ${(w / 4.3).toFixed(1)} 个月`;
}

function compilePlan(p: Profile, m: JobMatch, path: PathItem[]): string {
  const lines: string[] = [];
  lines.push(`# 职途规划 · ${m.title}`, "");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN")}`);
  lines.push(`背景：${p.major || "未填"} ${p.grade || ""}`);
  lines.push(`每周可投入：${p.hoursPerWeek} 小时`);
  lines.push("");
  lines.push(`## 目标岗位`, "");
  lines.push(`- ${m.title}（${m.trackName}）`);
  lines.push(`- 必备技能覆盖率：${m.coverage}%　匹配分：${m.score}`);
  lines.push(`- 补齐缺口：${m.gapHours} 小时，按每周 ${p.hoursPerWeek} 小时计 ${fmtWeeks(m.etaWeeks)}`);
  lines.push(`- 薪资参考：实习 ${m.salary.intern}　应届 ${m.salary.junior}`);
  lines.push(`- 入门门槛：${m.threshold}`);
  lines.push("");
  lines.push(`## 已具备的必备技能`, "");
  m.covered.forEach((s) => lines.push(`- ${s.name}（权重 ${s.weight}）`));
  if (!m.covered.length) lines.push("- 暂无");
  lines.push("");
  lines.push(`## 接下来学什么`, "");
  if (!path.length) {
    lines.push("- 必备技能已全部覆盖，建议直接用真实 JD 做一次复核");
  } else {
    path.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.name}（权重 ${item.weight}，约 ${item.estHours} 小时，累计第 ${item.cumulativeWeeks} 周）`);
      item.resources.forEach((r) => {
        lines.push(`   - [${r.title}（${r.platform}）](${resolveUrl(r.platform, r.query)})`);
      });
    });
  }
  lines.push("");
  lines.push("---");
  lines.push("说明：匹配分 = 覆盖率×75% + 加分项×15% + 方向契合×10%；时长为经验估算，非精确值。");
  return lines.join("\n");
}

/* ============================================================
   记录导出 / 备份（全量 .md 与 .json）
   ============================================================ */
function downloadBlob(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function plansToMarkdown(plans: PlanRecord[]): string {
  return plans
    .map(
      (p, i) =>
        `# ${i + 1}. ${p.major || "未填专业"} · ${p.jobTitle}\n\n` +
        `> 保存于 ${new Date(p.createdAt).toLocaleString("zh-CN")}\n> ${p.summary}\n\n${p.markdown}`
    )
    .join("\n\n---\n\n");
}

function exportAllMd(plans: PlanRecord[]) {
  downloadBlob("职途-全部记录.md", plansToMarkdown(plans), "text/markdown;charset=utf-8");
}

/* ============================================================
   轻量 markdown 渲染（仅覆盖本项目导出所用语法；零依赖）
   把保存的规划在「我的记录 → 详情」里渲染成可读、链接可点。
   ============================================================ */
function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return `${url.host.replace(/^www\./, "")}${url.pathname.length > 1 ? url.pathname.slice(0, 24) : ""}${url.search ? "…" : ""}`;
  } catch {
    return u;
  }
}

/** 把一行里的 markdown 链接 [t](u) 与裸 URL 转成可点 <a> */
function inlineMd(text: string) {
  const parts = text.split(/(\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g);
  return parts.map((p, i) => {
    const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline decoration-accent/25 underline-offset-2 transition-colors hover:decoration-accent"
        >
          {link[1]}
        </a>
      );
    }
    if (/^https?:\/\//.test(p)) {
      return (
        <a
          key={i}
          href={p}
          target="_blank"
          rel="noreferrer"
          className="break-all text-accent underline decoration-accent/25 underline-offset-2 transition-colors hover:decoration-accent"
          title={p}
        >
          {shortUrl(p)}
        </a>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function PlanMd({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        const h1 = line.match(/^# (.*)/);
        const h2 = line.match(/^## (.*)/);
        const h3 = line.match(/^### (.*)/);
        if (h1)
          return (
            <div key={i} className="pt-1 text-[1.05rem] font-semibold tracking-tight text-foreground">
              {inlineMd(h1[1])}
            </div>
          );
        if (h2)
          return (
            <div key={i} className="pt-2.5 text-[0.95rem] font-semibold tracking-tight text-foreground">
              {inlineMd(h2[1])}
            </div>
          );
        if (h3)
          return (
            <div key={i} className="pt-2 text-sm font-semibold tracking-tight text-foreground">
              {inlineMd(h3[1])}
            </div>
          );
        if (/^---+$/.test(line))
          return <div key={i} className="my-2 border-t border-border" />;
        if (line.startsWith(">"))
          return (
            <div key={i} className="text-xs leading-relaxed text-muted">
              {inlineMd(line.slice(1).trim())}
            </div>
          );
        const liIndent = line.match(/^(\s*)[-•]\s+(.*)/);
        const liNum = line.match(/^(\s*)(\d+)\.\s+(.*)/);
        if (liIndent || liNum) {
          const indent = (liIndent?.[1] || liNum?.[1] || "").length;
          const marker = liNum ? `${liNum[2]}.` : "•";
          const content = (liIndent?.[2] ?? liNum?.[3] ?? "").trim();
          const isResource = indent >= 2 && line.includes("http");
          if (isResource) {
            // 资源行：整行做成可点行（避免 a 套 a），链接标题单独提取
            const mdLink = content.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
            const bareUrl = mdLink ? null : content.match(/(https?:\/\/[^\s)]+)/);
            const href = mdLink ? mdLink[2] : bareUrl ? bareUrl[1] : null;
            if (href) {
              const display = mdLink
                ? mdLink[1]
                : content.replace(/(https?:\/\/[^\s)]+)/, "").trim() || shortUrl(href);
              return (
                <a
                  key={i}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent-soft"
                  title={href}
                >
                  <span className="min-w-0 truncate">{display}</span>
                  <span className="shrink-0 text-muted">↗ 打开</span>
                </a>
              );
            }
          }
          return (
            <div key={i} className="flex gap-2 text-sm leading-relaxed" style={{ paddingLeft: Math.min(indent, 4) * 0.6 + "rem" }}>
              <span className="shrink-0 text-muted">{marker}</span>
              <span className="min-w-0">{inlineMd(content)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-1" />;
        return (
          <p key={i} className="text-sm leading-relaxed text-foreground">
            {inlineMd(line)}
          </p>
        );
      })}
    </div>
  );
}

function backupAllJson(plans: PlanRecord[]) {
  const payload = {
    app: "职途 career-navigator",
    dataVersion: DATA_META.version,
    exportedAt: new Date().toISOString(),
    count: plans.length,
    plans,
  };
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(
    `职途-备份-${stamp}.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8"
  );
}

/* ============================================================
   档案切换器（多档案：保存 / 切换 / 重命名 / 删除）
   ============================================================ */
function ProfileSwitcher({
  profiles,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: {
  profiles: ProfileRowFront[];
  activeId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameVal, setNameVal] = useState("");
  const current = profiles.find((p) => p.id === activeId);

  function startRename(p: ProfileRowFront) {
    setRenaming(p.id);
    setNameVal(p.name);
  }
  function commitRename(id: string) {
    const trimmed = nameVal.trim();
    if (trimmed) onRename(id, trimmed);
    setRenaming(null);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="chip-btn whitespace-nowrap"
        title="切换 / 新建求职档案"
      >
        {current?.name || "未命名档案"} ▾
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-border bg-[var(--surface-2)] p-2 shadow-xl">
          {profiles.length === 0 && (
            <div className="px-2 py-1 text-xs text-muted">暂无档案</div>
          )}
          {profiles.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-1 rounded px-1 py-1 hover:bg-accent-soft"
            >
              {renaming === p.id ? (
                <input
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  onBlur={() => commitRename(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(p.id);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-xs text-foreground"
                />
              ) : (
                <button
                  onClick={() => {
                    onSwitch(p.id);
                    setOpen(false);
                  }}
                  className={`flex-1 truncate text-left text-xs ${
                    p.id === activeId
                      ? "font-semibold text-accent-strong"
                      : "text-foreground"
                  }`}
                >
                  {p.name || "未命名档案"}
                </button>
              )}
              <button
                onClick={() => startRename(p)}
                className="px-1 text-xs text-muted hover:text-foreground"
                title="重命名"
              >
                ✎
              </button>
              <button
                onClick={() => {
                  const nm = p.name || "未命名档案";
                  if (confirm(`删除档案「${nm}」？其中的进度与打卡记录会一并清除，且不可撤销。`)) {
                    onDelete(p.id);
                    setOpen(false);
                  }
                }}
                className="px-1 text-xs text-muted hover:text-red-500"
                title="删除"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              onCreate();
              setOpen(false);
            }}
            className="mt-1 w-full rounded border border-dashed border-border px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            + 新建档案
          </button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   主流程
   ============================================================ */
export default function Home() {
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [view, setView] = useState<"landing" | "records">("landing");
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [doneSkills, setDoneSkills] = useState<string[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  /** 统一下发全局动态提示：错误走红 Toast，成功/中性反馈走蓝 Toast */
  const handleNotice = (msg: string, kind: "error" | "info") =>
    kind === "error" ? setError(msg) : setInfo(msg);

  // 动态提示自动消失（错误/成功共用一个计时器，新提示会重置）
  useEffect(() => {
    if (!error && !info) return;
    const t = setTimeout(() => {
      setError(null);
      setInfo(null);
    }, 3800);
    return () => clearTimeout(t);
  }, [error, info]);
  const [ready, setReady] = useState(false);
  const [profiles, setProfiles] = useState<ProfileRowFront[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("local");

  // 打卡完成的技能并入已勾选的技能，参与所有计算：缺口随进度实时下降
  const effective = useMemo<Profile>(
    () => ({
      ...profile,
      knownSkillIds: Array.from(new Set([...profile.knownSkillIds, ...doneSkills])),
    }),
    [profile, doneSkills]
  );

  const matches = useMemo(() => rankJobs(effective, 20), [effective]);
  const topMatches = useMemo(() => matches.slice(0, 8), [matches]);
  // localStorage 里可能存着已被改名或删除的岗位 id，直接用会让 matchJob 抛错、整页白屏
  const activeId =
    selectedJobId && jobIds().has(selectedJobId)
      ? selectedJobId
      : topMatches[0]?.jobId || "";
  const selected = useMemo(
    () => (activeId ? matchJob(effective, activeId) : null),
    [effective, activeId]
  );
  const path = useMemo(
    () => (activeId ? buildPath(effective, activeId) : []),
    [effective, activeId]
  );
  const gapMap = useMemo(
    () => buildGapMap(effective, topMatches.slice(0, 5).map((m) => m.jobId)),
    [effective, topMatches]
  );

  // 草稿：只在挂载时读取，不自动套用，避免打开就跳进旧流程让用户困惑
  const draftRef = useRef<Persisted | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => {
    loadProfilesFromServer().then((list) => {
      const display: ProfileRowFront[] =
        list.length > 0
          ? list
          : [
              {
                id: "local",
                name: "档案 1",
                step: 0,
                started: false,
                profile: emptyProfile,
                selectedJobId: "",
                doneSkills: [],
                updatedAt: new Date().toISOString(),
              },
            ];
      setProfiles(display);
      let active = display[0].id;
      try {
        const stored = localStorage.getItem(ACTIVE_KEY);
        if (stored && display.some((p) => p.id === stored)) active = stored;
      } catch {
        /* 忽略 */
      }
      setActiveProfileId(active);
      loadProfileFromServer(active).then((s) => {
        draftRef.current = s;
        const has = !!(s && (s.started || (s.profile && s.profile.knownSkillIds?.length)));
        setHasDraft(has);
        // 无草稿的新用户直接开启持久化，避免"新用户进度不落库"的旧问题
        setRestored(!has);
      });
    });
  }, []);

  // 从内部数据接口取知识库（来自 SQLite，非 LLM），注入算法层后再放行 UI
  useEffect(() => {
    let alive = true;
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((kb) => {
        if (!alive) return;
        initKB(kb);
        setReady(true);
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 用户做出"继续 / 重新开始"决定后，才允许持久化，避免覆盖未采用的草稿
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!restored) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const snapshot: Persisted = { step, started, profile, selectedJobId, doneSkills };
    const foundName = profiles.find((p) => p.id === activeProfileId)?.name;
    const nm = foundName || (activeProfileId === "local" ? "档案 1" : "");
    saveTimer.current = setTimeout(() => {
      pushProfileToServer(snapshot, activeProfileId, nm);
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [restored, step, started, profile, selectedJobId, doneSkills, activeProfileId, profiles]);

  function continueDraft() {
    const s = draftRef.current;
    if (s) {
      setStep(s.step ?? 0);
      setProfile({ ...emptyProfile, ...(s.profile || {}) });
      setSelectedJobId(s.selectedJobId ?? "");
      setDoneSkills(s.doneSkills ?? []);
      const resume = !!(s.started || (s.step ?? 0) > 0);
      setStarted(resume);
    }
    setRestored(true);
    setHasDraft(false);
  }

  function applyProfile(s: Persisted | null) {
    if (s) {
      setStep(s.step ?? 0);
      setProfile({ ...emptyProfile, ...(s.profile || {}) });
      setSelectedJobId(s.selectedJobId ?? "");
      setDoneSkills(s.doneSkills ?? []);
      setStarted(!!(s.started || (s.step ?? 0) > 0));
    } else {
      reset();
    }
  }

  function switchTo(id: string) {
    if (id === activeProfileId) return;
    loadProfileFromServer(id).then((s) => {
      setActiveProfileId(id);
      try {
        localStorage.setItem(ACTIVE_KEY, id);
      } catch {
        /* 忽略 */
      }
      applyProfile(s);
      setRestored(true);
      setHasDraft(false);
      loadProfilesFromServer().then(setProfiles);
    });
  }

  function createProfile() {
    const id = `p_${Date.now()}`;
    const name = `档案 ${profiles.length + 1}`;
    const empty: Persisted = {
      step: 0,
      started: false,
      profile: emptyProfile,
      selectedJobId: "",
      doneSkills: [],
    };
    pushProfileToServer(empty, id, name);
    setActiveProfileId(id);
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* 忽略 */
    }
    setProfiles((list) => [
      {
        id,
        name,
        step: 0,
        started: false,
        profile: emptyProfile,
        selectedJobId: "",
        doneSkills: [],
        updatedAt: new Date().toISOString(),
      },
      ...list,
    ]);
    applyProfile(null);
    setRestored(true);
    setHasDraft(false);
  }

  function renameProfile(id: string, name: string) {
    const row = profiles.find((p) => p.id === id);
    if (!row) return;
    const s: Persisted = {
      step: row.step,
      started: row.started,
      profile: row.profile,
      selectedJobId: row.selectedJobId,
      doneSkills: row.doneSkills,
    };
    pushProfileToServer(s, id, name);
    setProfiles((list) => list.map((p) => (p.id === id ? { ...p, name } : p)));
  }

  function deleteProfile(id: string) {
    deleteProfileOnServer(id);
    setProfiles((list) => {
      const next = list.filter((p) => p.id !== id);
      if (id === activeProfileId) {
        const fallback = next[0];
        if (fallback) {
          setActiveProfileId(fallback.id);
          try {
            localStorage.setItem(ACTIVE_KEY, fallback.id);
          } catch {
            /* 忽略 */
          }
          loadProfileFromServer(fallback.id).then((s) => {
            applyProfile(s);
            setRestored(true);
          });
        } else {
          setActiveProfileId("local");
          applyProfile(null);
          setRestored(true);
        }
      }
      return next;
    });
  }

  useEffect(() => {
    loadPlansFromServer().then(setPlans);
  }, []);

  function goToStep(i: number) {
    if (i >= 0 && i <= STEPS.length - 1) setStep(i);
  }

  function reset() {
    setStep(0);
    setStarted(false);
    setProfile(emptyProfile);
    setDoneSkills([]);
    setSelectedJobId("");
    setError(null);
    setInfo(null);
  }

  function saveCurrentPlan() {
    if (!selected) return;
    const temps = profile.tempSkillIds || [];
    const rec: PlanRecord = {
      id: `${profile.major}|${selected.jobId}|${Date.now()}`,
      createdAt: Date.now(),
      major: profile.major,
      jobTitle: selected.title,
      summary: `覆盖率 ${selected.coverage}% · 缺口 ${selected.gapHours} 小时 · ${fmtWeeks(selected.etaWeeks)}`,
      markdown: compilePlan(effective, selected, path),
    };
    pushPlanToServer(rec);
    setPlans((list) => [rec, ...list.filter((p) => p.id !== rec.id)].slice(0, 50));
    // 「一次性」临时技能：本次规划已保存快照，自动移除，避免带进下一次计算
    if (temps.length) {
      const rem = new Set(temps);
      setProfile((p) => ({
        ...p,
        knownSkillIds: p.knownSkillIds.filter((id) => !rem.has(id)),
        tempSkillIds: [],
      }));
      setInfo(`已自动移除 ${temps.length} 项临时技能（本次规划已保存）；下次要用可回第 1 步重新添加`);
    }
  }

  if (!ready) {
    return (
      <main className="app-shell grid min-h-screen place-items-center px-4">
        <div className="text-center">
          <div className="text-lg font-semibold tracking-tight text-foreground">
            <span>职途</span>
          </div>
          <div className="mt-2 text-sm text-muted">正在从数据库载入岗位知识库…</div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell min-h-screen px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div>
          <h1
            onClick={() => {
              setStarted(false);
              setView("landing");
            }}
            title="返回首页"
            className="cursor-pointer text-xl font-semibold tracking-tight text-foreground"
          >
            <span>职途</span>
            <span className="ml-2 inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-medium text-accent-strong">
              v{DATA_META.version}
            </span>
          </h1>
          <p className="mt-1 text-xs text-muted">
            岗位要求 × 你的技能 · 每个数字都能拆开看
          </p>
        </div>
        <ProfileSwitcher
          profiles={profiles}
          activeId={activeProfileId}
          onSwitch={switchTo}
          onCreate={createProfile}
          onRename={renameProfile}
          onDelete={deleteProfile}
        />
        {started && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setStarted(false);
                setView("landing");
              }}
              className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-xs"
            >
              返回首页
            </button>
            {step > 0 && (
              <button
                onClick={() => {
                  if (confirm("重新开始会清空已填的内容和选择，确定要重来吗？")) reset();
                }}
                className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-xs"
              >
                重新开始
              </button>
            )}
          </div>
        )}
      </header>

      {view === "records" ? (
        <Records
          plans={plans}
          onBack={() => setView("landing")}
          onDelete={(id) => {
            removePlanOnServer(id);
            setPlans((list) => list.filter((p) => p.id !== id));
          }}
        />
      ) : !started ? (
        <Landing
          draft={
            hasDraft
              ? {
                  major: draftRef.current?.profile?.major || "",
                  step: draftRef.current?.step ?? 0,
                }
              : null
          }
          onStart={() => {
            reset();
            setStarted(true);
            setRestored(true);
            setHasDraft(false);
          }}
          onContinue={continueDraft}
          onRecords={() => {
            loadPlansFromServer().then(setPlans);
            setView("records");
          }}
          plansCount={plans.length}
        />
      ) : (
        <>
          <Progress step={step} onStepClick={goToStep} />
          <p className="mt-2 text-xs text-muted">进度已自动保存，刷新不丢失</p>

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

          <div key={step} className="mt-6 animate-step">
            {step === 0 && (
              <ProfileForm
                profile={profile}
                setProfile={setProfile}
                setError={setError}
                onNotice={handleNotice}
                onNext={() => {
                  if (!profile.knownSkillIds.length) {
                    setError(
                      "至少要有 1 项「技能库里的技能」才能开始计算：先点自动识别或从技能库手动挑；自定义添加的技能只作记录、不参与评分"
                    );
                    return;
                  }
                  setError(null);
                  setStep(1);
                }}
              />
            )}

            {step === 1 && (
              <Orientation
                profile={effective}
                matches={matches}
                onBack={() => setStep(0)}
                onNext={() => setStep(2)}
              />
            )}

            {step === 2 && (
              <JobList
                matches={topMatches}
                selectedId={activeId}
                targetTracks={effective.targetTracks}
                onSelect={(id) => {
                  setSelectedJobId(id);
                  setStep(3);
                }}
                onBack={() => setStep(1)}
              />
            )}

            {step === 3 && selected && (
              <GapView
                match={selected}
                gapMap={gapMap}
                onBack={() => setStep(2)}
                onNext={() => setStep(4)}
              />
            )}

            {step === 4 && selected && (
              <PathView
                match={selected}
                path={path}
                hoursPerWeek={effective.hoursPerWeek}
                doneSkills={doneSkills}
                onToggleDone={(id) =>
                  setDoneSkills((prev) =>
                    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                  )
                }
                onSave={saveCurrentPlan}
                onGoRecords={() => {
                  loadPlansFromServer().then(setPlans);
                  setView("records");
                }}
                onBack={() => setStep(3)}
              />
            )}
          </div>
        </>
      )}

      <Footer />
    </main>
  );
}

/* ============================================================
   数据说明 footer · 透明提示数据来源与时效
   ============================================================ */
function Footer() {
  return (
    <footer className="mt-10 border-t border-border pt-4 text-xs leading-relaxed text-muted">
      <div>
        职途 · 数据版本 v{DATA_META.version} · 内置 {jobIds().size} 个岗位 / {allSkills().length} 项技能 · 数据来自本地 SQLite
        {" · "}
        <a href="/admin" className="underline hover:text-foreground">
          后台编辑
        </a>
      </div>
      <div className="mt-1">{DATA_META.salaryNote}</div>
      <div className="mt-1">
        匹配公式：覆盖率 ×75% + 加分项 ×15% + 方向契合 ×10%；时长为经验估算，非精确值。
      </div>
    </footer>
  );
}

/* ============================================================
   Step 0 · 我的情况
   ============================================================ */
function ProfileForm({
  profile,
  setProfile,
  setError: reportError,
  onNotice,
  onNext,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  setError: (msg: string | null) => void;
  onNotice: (msg: string, kind: "error" | "info") => void;
  onNext: () => void;
}) {
  const skills = allSkills();
  const tracks = allTracks();
  const groups = useMemo(() => {
    const m = new Map<string, typeof skills>();
    for (const s of skills) {
      if (!m.has(s.category)) m.set(s.category, []);
      m.get(s.category)!.push(s);
    }
    return Array.from(m.entries());
  }, [skills]);

  const set = (k: keyof Profile, v: any) => setProfile({ ...profile, [k]: v });

  function toggleSkill(id: string) {
    const has = profile.knownSkillIds.includes(id);
    if (has) {
      setProfile({
        ...profile,
        knownSkillIds: profile.knownSkillIds.filter((x) => x !== id),
        tempSkillIds: (profile.tempSkillIds || []).filter((x) => x !== id),
      });
    } else {
      setProfile({ ...profile, knownSkillIds: [...profile.knownSkillIds, id] });
    }
  }

  function toggleTrack(id: string) {
    const has = profile.targetTracks.includes(id);
    set(
      "targetTracks",
      has ? profile.targetTracks.filter((x) => x !== id) : [...profile.targetTracks, id]
    );
  }

  const [customInput, setCustomInput] = useState("");
  // 未命中库内词条时的映射待选：输入「仅记录」前先让用户决定要不要按某个相近技能计入本次评分
  const [suggestFor, setSuggestFor] = useState<string | null>(null);

  /** 未命中词条 → 找最多 6 个名称/别名沾边的库内技能，供用户「临时按它计分」 */
  function suggestCandidates(raw: string) {
    const low = raw.toLowerCase();
    if (low.length < 2) return [];
    const sc = skills.filter((s) => {
      const names = [s.name.toLowerCase(), ...s.aliases.map((a) => a.toLowerCase())];
      return names.some((n) => n.includes(low) || low.includes(n));
    });
    return sc.sort((a, b) => a.name.length - b.name.length).slice(0, 6);
  }

  // 学习小时数：本地字符串态，允许清空/自由输入，失焦或回车时才落库，
  // 避免「删不掉、强制回 1」的输入 bug；合法范围 1–80，非法/空回默认 10
  const [hoursRaw, setHoursRaw] = useState(String(profile.hoursPerWeek));
  useEffect(() => {
    setHoursRaw(String(profile.hoursPerWeek));
  }, [profile.hoursPerWeek]);
  const HOUR_PRESETS = [4, 6, 10, 12, 15, 20, 30];

  function commitHours() {
    const t = hoursRaw.trim();
    const v = t === "" ? NaN : Number(t);
    const next = Number.isFinite(v) && v >= 1 && v <= 80 ? v : 10;
    setHoursRaw(String(next));
    if (next !== profile.hoursPerWeek) set("hoursPerWeek", next);
  }

  /** 自动识别：优先用已填资料；命中即预勾选并提示「仅供参考，请核对」 */
  function autoDetect() {
    const text = profileText(profile);
    if (!text.trim()) {
      reportError("先在专业 / 作品 / 介绍里写点内容，或上传一份简历，我再帮你识别");
      return;
    }
    const detected = detectSkills(text);
    if (!detected.length) {
      reportError("没识别到知识库里的技能关键词——直接在上方输入框里添加你会的技能也行");
      return;
    }
    const fresh = detected.filter((id) => !profile.knownSkillIds.includes(id));
    if (!fresh.length) {
      onNotice("你填的内容里能识别的技能都已经勾上了", "info");
      return;
    }
    set("knownSkillIds", [...profile.knownSkillIds, ...fresh]);
    onNotice(
      `从填的内容里识别到 ${fresh.length} 项，已预勾选——自动识别仅供参考，可能有偏差，请逐条核对`,
      "info"
    );
  }

  /**
   * 自由添加：优先对齐知识库词条（名称/别名精确或包含命中 → 计入评分）；
   * 完全对不上 → 存为自定义技能，仅记录不参与匹配分，避免“库里没有就加不了”。
   */
  function addCustom() {
    const raw = customInput.trim();
    if (!raw) return;
    const low = raw.toLowerCase();
    const exact = skills.find(
      (s) =>
        s.name.toLowerCase() === low ||
        s.aliases.some((a) => a.toLowerCase() === low)
    );
    let matched = exact;
    if (!matched) {
      const sub = skills.filter(
        (s) =>
          low.includes(s.name.toLowerCase()) ||
          s.name.toLowerCase().includes(low)
      );
      matched = sub.sort((a, b) => a.name.length - b.name.length)[0];
    }
    if (matched) {
      if (!profile.knownSkillIds.includes(matched.id)) {
        set("knownSkillIds", [...profile.knownSkillIds, matched.id]);
        onNotice(`「${matched.name}」在技能库里，已帮你勾上`, "info");
      } else {
        onNotice(`「${matched.name}」已经在列表里了`, "info");
      }
    } else {
      const cands = suggestCandidates(raw);
      if (cands.length) {
        // 有相近库内词条 → 不自动落自定义，先让用户选「临时按哪个计分」
        setSuggestFor(raw);
        return;
      }
      if (!profile.customSkills.includes(raw)) {
        set("customSkills", [...profile.customSkills, raw]);
        onNotice(
          `已添加「${raw}」；知识库里找不到接近的词条，它不参与匹配分，只作记录`,
          "info"
        );
      } else {
        onNotice(`「${raw}」已经在列表里了`, "info");
      }
    }
    setCustomInput("");
  }

  /** 把用户自定义说法按库内技能一次性计入（保存本次规划后自动移除；不写全局知识库） */
  function addAsMapped(raw: string, skillId: string) {
    const s = SKILL_MAP[skillId];
    if (!s) return;
    if (!profile.knownSkillIds.includes(skillId)) {
      setProfile({
        ...profile,
        knownSkillIds: [...profile.knownSkillIds, skillId],
        tempSkillIds: [...(profile.tempSkillIds || []), skillId],
      });
      onNotice(
        `已把「${raw}」按「${s.name}」临时计入（同权重参与本次计算，保存这份规划后会自动移除）`,
        "info"
      );
    } else {
      onNotice(`「${s.name}」已经在列表里了`, "info");
    }
    setSuggestFor(null);
    setCustomInput("");
  }

  function removeCustom(name: string) {
    set("customSkills", profile.customSkills.filter((x) => x !== name));
  }

  const totalKnown = profile.knownSkillIds.length + profile.customSkills.length;

  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">先说说你的情况</h2>
      <p className="mt-1 text-sm text-muted">
        结构化填写，后面的每一个数字都由这里算出。
      </p>

      <div className="card mt-5 p-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="lbl">专业</span>
            <input
              className="input"
              placeholder="数据科学与大数据技术"
              value={profile.major}
              onChange={(e) => set("major", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="lbl">年级</span>
            <input
              className="input"
              placeholder="大三"
              value={profile.grade}
              onChange={(e) => set("grade", e.target.value)}
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="lbl">作品 / 项目</span>
          <textarea
            className="input min-h-[76px] resize-y"
            placeholder="做过什么、用了什么技术、结果如何"
            value={profile.works}
            onChange={(e) => set("works", e.target.value)}
          />
        </label>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="lbl">证书</span>
            <input
              className="input"
              placeholder="计算机二级、英语四级…"
              value={profile.certificates}
              onChange={(e) => set("certificates", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="lbl">兴趣方向</span>
            <input
              className="input"
              placeholder="AI 产品、数据分析…"
              value={profile.interests}
              onChange={(e) => set("interests", e.target.value)}
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="lbl">自我介绍</span>
          <textarea
            className="input min-h-[76px] resize-y"
            placeholder="你怎么描述自己，会用于自动识别技能"
            value={profile.selfDescription}
            onChange={(e) => set("selfDescription", e.target.value)}
          />
        </label>
      </div>

      <div className="card mt-4 p-5">
        <h3 className="text-base font-medium text-foreground">简历导入（选填）</h3>
        <p className="mt-0.5 text-xs text-muted">
          有简历就传一份：本地解析出文字后自动识别技能并预勾选，比手动填更省事
        </p>
        <div className="mt-3">
          <ResumeImport
            onNotice={onNotice}
            onDetected={(ids) =>
              set("knownSkillIds", Array.from(new Set([...profile.knownSkillIds, ...ids])))
            }
          />
        </div>
      </div>

      <div className="card mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-medium text-foreground">
              你会什么
              <span className="ml-2 text-xs font-normal text-muted">
                已确认 {totalKnown} 项
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              不用翻列表——自动从你填的资料、导入的简历里挑候选，你核对后留下靠谱的
            </p>
          </div>
          <button onClick={autoDetect} className="btn btn-ghost shrink-0 whitespace-nowrap px-3 py-1.5 text-xs">
            从填的内容识别
          </button>
        </div>

        {profile.knownSkillIds.length > 0 && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              {profile.knownSkillIds.map((id) => {
                const s = SKILL_MAP[id];
                if (!s) return null;
                const isTemp = (profile.tempSkillIds || []).includes(id);
                return (
                  <button
                    key={id}
                    onClick={() => toggleSkill(id)}
                    className="chip-btn on"
                    title={
                      isTemp
                        ? `${s.name} · 临时技能（本次规划用，保存后自动移除；点一下取消）`
                        : `${s.name} · 已勾选（点一下取消）`
                    }
                  >
                    {s.name}
                    {isTemp && <span className="ml-1 text-[0.65rem] font-normal opacity-70">临时</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted">
              上面的条目来自自动识别或手动勾选。自动识别仅供参考、可能不准确，点一下就能取消；
              带「临时」标记的只在本次规划有效，保存后会自动移除
            </p>
          </div>
        )}

        {profile.knownSkillIds.length === 0 && profile.customSkills.length === 0 && (
          <p className="mt-4 text-xs text-muted">
            还没添加技能。填好上方资料后点「从填的内容识别」，或直接拖一份简历上来；
            也可以在下方的输入框里直接添加。
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="直接输入你会的技能，如「Vue」「接口测试」，回车或点添加"
            className="input"
            style={{ flex: 1 }}
          />
          <button onClick={addCustom} className="btn btn-ghost shrink-0 px-3 py-1.5 text-xs">
            添加
          </button>
        </div>

        {suggestFor && (
          <div className="mt-3 rounded-xl bg-[var(--surface-2)] p-3">
            <div className="text-xs text-foreground">
              「{suggestFor}」不在知识库里。下面这些比较接近——选一个会<strong>按它临时计分</strong>（仅当前档案，随时可取消）：
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestCandidates(suggestFor).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => addAsMapped(suggestFor, s.id)}
                  className="chip-btn px-2.5 py-1 text-xs"
                  title={`按「${s.name}」计入评分（预估掌握需 ${s.estHours} 小时）`}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!profile.customSkills.includes(suggestFor)) {
                    set("customSkills", [...profile.customSkills, suggestFor]);
                    onNotice(
                      `已把「${suggestFor}」存为自定义记录，不参与评分（库内没有可信的相近词条）`,
                      "info"
                    );
                  }
                  setSuggestFor(null);
                  setCustomInput("");
                }}
                className="btn btn-ghost px-2.5 py-1 text-xs"
              >
                都不太对 → 仅记录
              </button>
              <button
                type="button"
                onClick={() => {
                  setSuggestFor(null);
                  setCustomInput("");
                }}
                className="px-2.5 text-xs text-muted hover:text-foreground"
              >
                算了
              </button>
            </div>
          </div>
        )}

        {profile.customSkills.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-medium text-muted">自定义添加（仅记录，不影响匹配分）</div>
            <div className="flex flex-wrap gap-2">
              {profile.customSkills.map((c) => (
                <button
                  key={c}
                  onClick={() => removeCustom(c)}
                  className="chip-btn on"
                  title={`${c} · 自定义技能（点一下移除）`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        <details className="mt-4 group">
          <summary className="cursor-pointer select-none text-xs text-muted transition-colors hover:text-foreground">
            手动从技能库挑（共 {skills.length} 项，按分类）——一般用不到，供精确补充
          </summary>
          <div className="mt-3 space-y-3">
            {groups.map(([cat, list]) => (
              <div key={cat}>
                <div className="mb-2 text-xs font-medium text-muted">{cat}</div>
                <div className="flex flex-wrap gap-2">
                  {list.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => toggleSkill(s.id)}
                      className={`chip-btn ${profile.knownSkillIds.includes(s.id) ? "on" : ""}`}
                      title={`预估掌握需 ${s.estHours} 小时`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>

      <div className="card mt-4 p-5">
        <h3 className="text-base font-medium text-foreground">想去的领域</h3>
        <p className="mt-0.5 text-xs text-muted">
          可多选。不选则全部同等对待，选了会给对应方向加权
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {tracks.map((t) => (
            <button
              key={t.id}
              onClick={() => toggleTrack(t.id)}
              className={`chip-btn ${profile.targetTracks.includes(t.id) ? "on" : ""}`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <label className="mt-5 block">
          <span className="lbl">每周能投入的学习时间</span>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={80}
              step={1}
              value={hoursRaw}
              onChange={(e) => setHoursRaw(e.target.value)}
              onBlur={commitHours}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitHours();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="input no-spinner w-24 text-base font-semibold tracking-tight tabular-nums"
              aria-label="每周学习小时数"
              placeholder="10"
            />
            <span className="text-sm text-muted">小时 / 周</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {HOUR_PRESETS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => {
                  setHoursRaw(String(h));
                  set("hoursPerWeek", h);
                }}
                className={`chip-btn px-3 py-1 text-xs num ${
                  profile.hoursPerWeek === h ? "on" : ""
                }`}
                title={`设为每周 ${h} 小时`}
              >
                {h} 小时
              </button>
            ))}
            {profile.hoursPerWeek > 0 && !HOUR_PRESETS.includes(profile.hoursPerWeek) && (
              <span className="chip-btn on px-3 py-1 text-xs num" title="你输入的自定义值，已生效">
                {profile.hoursPerWeek} 小时 · 自定义 ✓
              </span>
            )}
          </div>
          <span className="hint">
            最低 1 小时/周，默认 10。改这里，后面的「补齐大概 X 周」会跟着变
          </span>
        </label>

        <label className="mt-3 block">
          <span className="lbl">目标（选填）</span>
          <input
            className="input"
            placeholder="例：三个月内拿到 AI 产品实习"
            value={profile.goal}
            onChange={(e) => set("goal", e.target.value)}
          />
        </label>
      </div>

      <button onClick={onNext} className="btn btn-primary mt-5 w-full">
        看看哪个方向更合适
      </button>
    </section>
  );
}

/* ============================================================
   Step 1 · 看方向
   ============================================================ */
function Orientation({
  profile,
  matches,
  onBack,
  onNext,
}: {
  profile: Profile;
  matches: JobMatch[];
  onBack: () => void;
  onNext: () => void;
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
      <h2 className="text-xl font-semibold tracking-tight text-foreground">哪个方向更合你</h2>
      <p className="mt-1 text-sm text-muted">
        按你勾选的 {profile.knownSkillIds.length} 项技能，与 {jobIds().size} 个岗位的要求逐条对齐后的结果。
      </p>

      <div className="card mt-5 p-5">
        <div className="text-xs text-muted">当前最接近的领域</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          {best?.name || "—"}
        </div>
        <div className="mt-1 text-sm text-muted">
          平均技能覆盖率 {best?.avg ?? 0}%，最强匹配是「{best?.best.title ?? "—"}」
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
        <h3 className="text-base font-medium text-foreground">接下来怎么走</h3>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-muted">
          <li>
            · 覆盖率不是能力评分，它只说明「岗位要求里你已经会了多少」。
          </li>
          <li>
            · 优先补齐权重 3 的硬门槛技能，它们通常是初筛的过滤条件。
          </li>
          <li>
            · 时长均为经验估算，用于排序与节奏参考，不是承诺。
          </li>
        </ul>
      </div>

      <div className="mt-5 flex gap-3">
        <button onClick={onBack} className="btn btn-ghost flex-1">
          上一步 · 我的情况
        </button>
        <button onClick={onNext} className="btn btn-primary flex-1">
          去看看匹配的岗位
        </button>
      </div>
    </section>
  );
}

/* ============================================================
   Step 2 用 · 匹配分构成（公式公开，逐项给数）
   coverage 与方向项可精确给出；加分项只能拿到「命中名单」，
   如实标 0–15，不反推编数——数字可追溯优先于好看。
   ============================================================ */
function fmtScore(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function ScoreBreakdown({
  match,
  targetTracks,
}: {
  match: JobMatch;
  targetTracks: string[];
}) {
  const totalCore = match.covered.length + match.missing.length;
  const covPts = Math.round(match.coverage * 0.75 * 10) / 10;
  const dirOk = targetTracks.length === 0 || targetTracks.includes(match.track);
  const dirPts = dirOk ? 10 : 5;

  const rows: { label: string; scale: string; state: string; pts: string }[] = [
    {
      label: "必备技能覆盖率",
      scale: "×0.75",
      state: `必备技能命中 ${match.covered.length}/${totalCore} 项（按权重计 ${match.coverage}%）`,
      pts: `${fmtScore(covPts)} / 75`,
    },
    {
      label: "加分项",
      scale: "×0.15",
      state:
        match.plusCovered.length > 0
          ? `已命中：${match.plusCovered.join("、")}`
          : "未命中加分技能",
      pts: match.plusCovered.length > 0 ? "按命中计 0–15" : "0 / 15",
    },
    {
      label: "方向契合",
      scale: "×0.10",
      state: dirOk
        ? targetTracks.length === 0
          ? "未限定方向，不打折"
          : `勾选了「${match.trackName}」，不打折`
        : "未勾选此方向，按一半计",
      pts: `${fmtScore(dirPts)} / 10`,
    },
  ];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">匹配分构成</span>
        <span className="num text-xs text-foreground">合计 {match.score} 分</span>
      </div>
      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-muted">
        公开公式：覆盖率 ×0.75 ＋ 加分项 ×0.15 ＋ 方向契合 ×0.10，加总后四舍五入。
      </p>
      <div className="mt-1 text-xs">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <span className="text-foreground">{r.label}</span>
              <span className="ml-1.5 rounded border border-border bg-white px-1 align-middle text-[0.62rem] text-muted">
                {r.scale}
              </span>
              <div className="mt-0.5 truncate text-[0.68rem] text-muted">{r.state}</div>
            </div>
            <span className="num shrink-0 whitespace-nowrap text-muted">{r.pts}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Step 2 · 找岗位
   ============================================================ */
function JobList({
  matches,
  selectedId,
  targetTracks,
  onSelect,
  onBack,
}: {
  matches: JobMatch[];
  selectedId: string;
  targetTracks: string[];
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">哪些岗位适合你</h2>
      <p className="mt-1 text-sm text-muted">
        按匹配分排序（覆盖率 75% + 加分项 15% + 方向契合 10%）。点「依据」看计算过程。
      </p>

      <div className="mt-5">
        {matches.length === 0 ? (
          <div className="card p-8 text-center text-sm text-muted">
            知识库里还没有可匹配的岗位，或技能勾选过少导致没有命中。
            可回上一步多勾选几项技能，或到后台补充岗位数据。
          </div>
        ) : (
          <div className="space-y-3">
            {matches.map((m) => {
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
                  <div className="mt-0.5 num text-xs text-muted">匹配分 {m.score}</div>
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
                  实习 {m.salary.intern} · 应届 {m.salary.junior}
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
                  {selectedId === m.jobId ? "已选中 · 看还差什么" : "选它 · 看还差什么"}
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
                    <ScoreBreakdown match={m} targetTracks={targetTracks} />
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

      <button onClick={onBack} className="btn btn-ghost mt-5 w-full">
        返回上一步
      </button>
    </section>
  );
}

/* ============================================================
   Step 3 · 查差距
   ============================================================ */
function GapView({
  match,
  gapMap,
  onBack,
  onNext,
}: {
  match: JobMatch;
  gapMap: ReturnType<typeof buildGapMap>;
  onBack: () => void;
  onNext: () => void;
}) {
  const rows = [...match.covered, ...match.missing].sort((a, b) => b.weight - a.weight);
  const totalCore = rows.length;
  const coveredCount = match.covered.length;
  const missingHard = match.missing.filter((s) => s.weight === 3);

  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">你还差哪些技能</h2>
      <p className="mt-1 text-sm text-muted">
        目标岗位：{match.title} · 岗位要求 {totalCore} 项必备技能，你已具备{" "}
        {coveredCount} 项（覆盖 {match.coverage}%）
      </p>

      <div className="card mt-5 p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-medium text-foreground">这个岗位要求什么</h3>
          <span className="shrink-0 text-[0.68rem] text-muted">
            权重 3=硬门槛 · 2=重要 · 1=加分
          </span>
        </div>
        {missingHard.length > 0 && (
          <div className="mt-3 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs leading-relaxed text-foreground">
            <span className="tag w3 mr-1">硬门槛缺失</span>
            还差 {missingHard.map((s) => s.name).join("、")}——这类往往是投递初筛的硬条件，建议排在补齐的第一优先级。
          </div>
        )}
        <div className="mt-3 space-y-2">
          {rows.map((s) => {
            const known = match.covered.some((c) => c.id === s.id);
            return (
              <div key={s.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`shrink-0 text-xs ${known ? "text-accent" : "text-muted"}`}
                  >
                    {known ? "已具备" : "待补齐"}
                  </span>
                  <span className="truncate text-sm text-foreground">{s.name}</span>
                  <span className={`tag w${s.weight} shrink-0`}>
                    {s.weight === 3 ? "硬门槛" : s.weight === 2 ? "重要" : "加分"}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-muted">{s.estHours}h</span>
              </div>
            );
          })}
        </div>

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
          同一项技能被越多个岗位要求，越值得先补。表内可左右滑动。
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
                          !s.requiredBy.includes(j.title)
                            ? "cell-na"
                            : s.known
                              ? "cell-yes"
                              : "cell-no"
                        }`}
                      >
                        {!s.requiredBy.includes(j.title) ? "—" : s.known ? "有" : "缺"}
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
          查看学习计划
        </button>
      </div>
    </section>
  );
}

/* ============================================================
   Step 4 · 定计划
   ============================================================ */
function PathView({
  match,
  path,
  hoursPerWeek,
  doneSkills,
  onToggleDone,
  onSave,
  onGoRecords,
  onBack,
}: {
  match: JobMatch;
  path: PathItem[];
  hoursPerWeek: number;
  doneSkills: string[];
  onToggleDone: (id: string) => void;
  onSave: () => void;
  onGoRecords: () => void;
  onBack: () => void;
}) {
  const [saved, setSaved] = useState(false);

  function handleSave() {
    onSave();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">接下来补什么</h2>
      <p className="mt-1 text-sm text-muted">
        {match.title} · 按「权重 ÷ 耗时」排序，先补性价比高的
      </p>

      <div className="card mt-5 p-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs text-muted">当前覆盖率</div>
            <div className="text-2xl font-semibold text-accent">{match.coverage}%</div>
          </div>
          <div className="text-right text-xs text-muted">
            {path.length ? (
              <>
                待补 {path.length} 项 · {match.gapHours} 小时
                <br />
                按每周 {hoursPerWeek} 小时，{fmtWeeks(match.etaWeeks)}可补齐
              </>
            ) : (
              <>必备技能已全部覆盖</>
            )}
          </div>
        </div>
        <div className="mt-3 track">
          <i style={{ width: `${match.coverage}%` }} />
        </div>
      </div>

      {!path.length ? (
        <div className="card mt-4 p-8 text-center text-sm text-muted">
          必备技能已全部覆盖。建议拿真实 JD 逐条复核，再决定是否投递。
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {path.map((item, i) => {
            const done = doneSkills.includes(item.skillId);
            return (
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
                        <span className={`tag w${item.weight}`}>
                          {item.weight === 3 ? "硬门槛" : item.weight === 2 ? "重要" : "加分"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        约 {item.estHours} 小时 · 优先级 {item.priority} · 累计第{" "}
                        {item.cumulativeWeeks} 周
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onToggleDone(item.skillId)}
                    className={`btn shrink-0 px-2.5 py-1 text-[0.7rem] ${
                      done ? "btn-primary" : "btn-ghost"
                    }`}
                  >
                    {done ? "已掌握" : "打卡"}
                  </button>
                </div>

                <div className="mt-2.5 space-y-1">
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
            );
          })}
        </div>
      )}

      {/* 打卡后技能会移出上面的待补清单，按钮随之消失，所以在这里单独给撤销入口 */}
      {doneSkills.length > 0 && (
        <div className="card mt-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-foreground">
              已打卡 {doneSkills.length} 项
            </h3>
            <button
              onClick={() => doneSkills.forEach((id) => onToggleDone(id))}
              className="shrink-0 text-xs text-muted transition-colors hover:text-accent"
            >
              全部撤销
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">
            打卡的技能已从待补清单移出，覆盖率按打卡结果实时重算。点任一项可撤销。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {doneSkills.map((id) => (
              <button
                key={id}
                onClick={() => onToggleDone(id)}
                title="点击撤销"
                className="chip-btn on"
              >
                {SKILL_MAP[id]?.name || id} ×
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex gap-3">
        <button onClick={onBack} className="btn btn-ghost flex-1">
          返回差距分析
        </button>
        <button onClick={handleSave} className="btn btn-primary flex-1">
          {saved ? "已保存 ✓" : "保存这份规划"}
        </button>
      </div>

      {saved && (
        <p className="mt-3 text-center text-xs text-accent">
          已写入「我的记录」
          <button onClick={onGoRecords} className="ml-2 underline underline-offset-2">
            去看看 →
          </button>
        </p>
      )}

      <p className="mt-3 text-[0.7rem] leading-relaxed text-muted">
        说明：时长为经验估算，用于排序与节奏参考；资源链接指向各平台搜索结果，内容可能更新，以搜索到的最新版本为准。
      </p>
    </section>
  );
}

/* ============================================================
   进度条
   ============================================================ */
function Progress({
  step,
  onStepClick,
}: {
  step: number;
  onStepClick: (i: number) => void;
}) {
  const pct = (step / (STEPS.length - 1)) * 100;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {STEPS.map((label, i) => {
          const finished = i < step;
          const current = i === step;
          const future = i > step;
          return (
            <button
              key={label}
              onClick={() => onStepClick(i)}
              disabled={future}
              title={future ? `先完成第 ${i} 步，前面步骤还没走` : finished ? `回到：${label}` : `当前：${label}`}
              className={`chip-btn ${current ? "on" : ""} ${finished ? "done" : ""} ${
                future ? "opacity-45" : ""
              }`}
            >
              {finished ? "✓ " : `${i + 1}. `}
              {label}
            </button>
          );
        })}
      </div>
      <div className="track">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ============================================================
   首页
   ============================================================ */
function Landing({
  draft,
  onStart,
  onContinue,
  onRecords,
  plansCount,
}: {
  draft: { major: string; step: number } | null;
  onStart: () => void;
  onContinue: () => void;
  onRecords: () => void;
  plansCount: number;
}) {
  const jobCount = jobIds().size;
  const skillCount = allSkills().length;
  const modules = [
    { n: "01", t: "我的情况", d: `把你会的东西挑出来——${skillCount} 项技能分门别类，也能从简历或文字里自动认个大概` },
    { n: "02", t: "找岗位", d: `拿 ${jobCount} 个岗位的要求跟你的技能逐个比对、排个先后，分数怎么来的能拆开看` },
    { n: "03", t: "查差距", d: "横向比几个相近岗位，看哪些技能最常被要求，先补复用率高的" },
    { n: "04", t: "定计划", d: "按「先学性价比高的」排计划，边学边打卡，缺口实时变小" },
  ];
  return (
    <section>
      <h2 className="text-[1.7rem] leading-snug font-semibold tracking-tight text-foreground sm:text-3xl">
        把「学过什么」
        <span className="text-accent">对齐</span>
        到「岗位要什么」
      </h2>
      <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-muted">
        内置 {jobCount} 个互联网岗位的必备技能与权重。不靠猜，靠算——匹配分
        = 覆盖率 ×0.75 + 加分项 ×0.15 + 方向契合 ×0.10，每个数字都能拆开看。
        无需注册，进度自动保存，刷新不丢。
      </p>

      {draft && (
        <div className="mt-6 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3">
          <div className="text-sm text-foreground">
            检测到上次的规划
            {draft.major ? `（${draft.major}）` : ""}
            ，进行到第 {draft.step + 1} 步
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={onContinue} className="btn btn-primary flex-1 py-2 text-xs">
              继续上次的规划
            </button>
            <button onClick={onStart} className="btn btn-ghost flex-1 py-2 text-xs">
              重新开始
            </button>
          </div>
        </div>
      )}

      <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {modules.map((m) => (
          <div key={m.n} className="card hover-lift p-5">
            <div className="flex items-baseline gap-2.5">
              <span className="num text-sm font-semibold tracking-tight text-accent">{m.n}</span>
              <h3 className="text-[0.95rem] font-semibold tracking-tight text-foreground">
                {m.t}
              </h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">{m.d}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-3">
        <button onClick={onStart} className="btn btn-primary flex-1">
          开始规划
        </button>
        <button onClick={onRecords} className="btn btn-ghost flex-1">
          我的记录{plansCount > 0 ? ` (${plansCount})` : ""}
        </button>
      </div>
    </section>
  );
}

/* ============================================================
   记录
   ============================================================ */
function Records({
  plans,
  onBack,
  onDelete,
}: {
  plans: PlanRecord[];
  onBack: () => void;
  onDelete: (id: string) => void;
}) {
  const [sel, setSel] = useState<PlanRecord | null>(null);
  if (sel) return <PlanDetail plan={sel} onBack={() => setSel(null)} />;
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">我的记录</h2>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={() => exportAllMd(plans)}
            disabled={!plans.length}
            title={
              plans.length
                ? `把 ${plans.length} 份规划拼成一份 .md 文件下载到本地`
                : "还没有记录"
            }
            className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-xs disabled:opacity-40"
          >
            下载全部 .md
          </button>
          <button
            onClick={() => backupAllJson(plans)}
            disabled={!plans.length}
            title={
              plans.length
                ? `把 ${plans.length} 份规划下载成一个 .json 文件，存在你电脑/网盘里，换设备时可用来恢复`
                : "还没有记录"
            }
            className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-xs disabled:opacity-40"
          >
            下载全部 .json
          </button>
          <button onClick={onBack} className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-xs">
            返回
          </button>
        </div>
      </div>

      {plans.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-sm text-foreground">还没有保存的规划</div>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
            走到最后一步后，点「保存这份规划」，就会出现在这里。
            单份规划可在详情页单独复制或下载。
          </p>
          <button onClick={onBack} className="btn btn-ghost mt-4 text-xs">
            先去做一份规划
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map((p) => (
            <div key={p.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => setSel(p)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium text-foreground">
                    {p.major || "未填专业"} · {p.jobTitle}
                  </div>
                  <div className="mt-1 text-xs text-muted">{p.summary}</div>
                  <div className="mt-1 text-xs text-muted">
                    {new Date(p.createdAt).toLocaleString("zh-CN")}
                  </div>
                </button>
                <button
                  onClick={() => {
                    const title = p.jobTitle || "这份规划";
                    if (confirm(`删除「${title}」？此操作不可撤销。`)) onDelete(p.id);
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:text-red-500"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PlanDetail({ plan, onBack }: { plan: PlanRecord; onBack: () => void }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(plan.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function handleDownload() {
    const blob = new Blob([plan.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `职途规划-${plan.jobTitle}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">规划详情</h2>
        <button onClick={onBack} className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-xs">
          返回
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        <button onClick={handleCopy} className="btn btn-ghost flex-1">
          {copied ? "已复制" : "复制"}
        </button>
        <button onClick={handleDownload} className="btn btn-ghost flex-1">
          下载 .md
        </button>
      </div>

      <div className="card p-5">
        <PlanMd text={plan.markdown} />
      </div>
    </section>
  );
}
