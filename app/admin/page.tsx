"use client";

import { useEffect, useState } from "react";

/* ---------- 类型 ---------- */
type JobRow = {
  id: string;
  title: string;
  track: string;
  summary: string;
  core: { s: string; w: number }[];
  plus: string[];
  threshold: string;
  salary: { intern: string; junior: string };
  certs: string[];
  growth: string;
};
type SkillRow = {
  id: string;
  name: string;
  category: string;
  aliases: string[];
  estHours: number;
  resources: { title: string; platform: string }[];
};
type TrackRow = { id: string; name: string };

/* ---------- 表单草稿 ---------- */
type JobForm = {
  id: string;
  title: string;
  track: string;
  summary: string;
  core: { s: string; w: number }[];
  plusText: string;
  threshold: string;
  intern: string;
  junior: string;
  certsText: string;
  growth: string;
};
type SkillForm = {
  id: string;
  name: string;
  category: string;
  aliasesText: string;
  estHours: string;
  resources: { title: string; platform: string }[];
};

const WEIGHT_LABEL: Record<number, string> = { 1: "1·加分", 2: "2·重要", 3: "3·硬门槛" };

const ID_RE = /^[a-z0-9][a-z0-9\-]*$/;

function FieldErrors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
      请先修正以下问题：
      <ul className="mt-1 list-inside list-disc space-y-0.5">
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<"jobs" | "skills">("jobs");
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  // 岗位表单
  const [jobOpen, setJobOpen] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [jobForm, setJobForm] = useState<JobForm>(emptyJob());

  // 技能表单
  const [skillOpen, setSkillOpen] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [skillForm, setSkillForm] = useState<SkillForm>(emptySkill());

  const [jobFilter, setJobFilter] = useState("");
  const [skillFilter, setSkillFilter] = useState("");
  // 删除确认：点「删除」先变成「确认 / 取消」，避免误触；busy 防止连点重复提交
  const [delTarget, setDelTarget] = useState<{ kind: "job" | "skill"; id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const kb = await (await fetch("/api/knowledge")).json();
      setJobs(kb.jobs);
      setSkills(kb.skills);
      setTracks(kb.tracks);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadAll();
  }, []);

  const skillName = (id: string) => skills.find((s) => s.id === id)?.name ?? id;
  const trackName = (id: string) => tracks.find((t) => t.id === id)?.name ?? id;

  /* ===================== 岗位 ===================== */
  function emptyJob(): JobForm {
    return {
      id: "",
      title: "",
      track: tracks[0]?.id ?? "",
      summary: "",
      core: [{ s: "", w: 3 }],
      plusText: "",
      threshold: "",
      intern: "",
      junior: "",
      certsText: "",
      growth: "",
    };
  }
  function openJob(job: JobRow | null) {
    setMsg(null);
    setEditingJobId(job ? job.id : null);
    setJobForm(
      job
        ? {
            id: job.id,
            title: job.title,
            track: job.track,
            summary: job.summary || "",
            core: job.core?.length ? job.core.map((c) => ({ s: c.s, w: c.w })) : [{ s: "", w: 3 }],
            plusText: (job.plus || []).join(", "),
            threshold: job.threshold || "",
            intern: job.salary?.intern || "",
            junior: job.salary?.junior || "",
            certsText: (job.certs || []).join(", "),
            growth: job.growth || "",
          }
        : emptyJob()
    );
    setJobOpen(true);
  }
  function setCore(i: number, patch: Partial<{ s: string; w: number }>) {
    setJobForm((f) => ({ ...f, core: f.core.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
  }
  async function saveJob() {
    if (busy) return;
    const isNew = !editingJobId;
    const payload = {
      id: jobForm.id.trim(),
      title: jobForm.title.trim(),
      track: jobForm.track,
      summary: jobForm.summary,
      core: jobForm.core.filter((c) => c.s).map((c) => ({ s: c.s.trim(), w: Number(c.w) })),
      plus: jobForm.plusText.split(",").map((s) => s.trim()).filter(Boolean),
      threshold: jobForm.threshold,
      salary: { intern: jobForm.intern, junior: jobForm.junior },
      certs: jobForm.certsText.split(",").map((s) => s.trim()).filter(Boolean),
      growth: jobForm.growth,
    };
    setBusy(true);
    try {
      const res = await fetch(
        isNew ? "/api/admin/jobs" : `/api/admin/jobs/${encodeURIComponent(jobForm.id.trim())}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "保存失败，请检查必填项" });
        return;
      }
      setMsg({
        type: "ok",
        text: `岗位「${payload.title || payload.id}」已${isNew ? "创建" : "更新"}。写入立即生效；若产品页已打开，请刷新后重新拉取知识库。`,
      });
      setJobOpen(false);
      await loadAll();
    } finally {
      setBusy(false);
    }
  }
  async function delJob(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "删除失败" });
        return;
      }
      setMsg({ type: "ok", text: `岗位 ${id} 已删除` });
      await loadAll();
    } finally {
      setBusy(false);
    }
  }

  /* ===================== 技能 ===================== */
  function emptySkill(): SkillForm {
    return { id: "", name: "", category: "", aliasesText: "", estHours: "0", resources: [] };
  }
  function openSkill(skill: SkillRow | null) {
    setMsg(null);
    setEditingSkillId(skill ? skill.id : null);
    setSkillForm(
      skill
        ? {
            id: skill.id,
            name: skill.name,
            category: skill.category || "",
            aliasesText: (skill.aliases || []).join(", "),
            estHours: String(skill.estHours ?? 0),
            resources: skill.resources?.length ? skill.resources.map((r) => ({ ...r })) : [],
          }
        : emptySkill()
    );
    setSkillOpen(true);
  }
  function setRes(i: number, patch: Partial<{ title: string; platform: string }>) {
    setSkillForm((f) => ({ ...f, resources: f.resources.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  }
  async function saveSkill() {
    if (busy) return;
    const isNew = !editingSkillId;
    const payload = {
      id: skillForm.id.trim(),
      name: skillForm.name.trim(),
      category: skillForm.category,
      aliases: skillForm.aliasesText.split(",").map((s) => s.trim()).filter(Boolean),
      estHours: Number(skillForm.estHours) || 0,
      resources: skillForm.resources.filter((r) => r.title || r.platform).map((r) => ({ ...r })),
    };
    setBusy(true);
    try {
      const res = await fetch(
        isNew ? "/api/admin/skills" : `/api/admin/skills/${encodeURIComponent(skillForm.id.trim())}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "保存失败，请检查必填项" });
        return;
      }
      setMsg({
        type: "ok",
        text: `技能「${payload.name || payload.id}」已${isNew ? "创建" : "更新"}。写入立即生效；若产品页已打开，请刷新后重新拉取知识库。`,
      });
      setSkillOpen(false);
      await loadAll();
    } finally {
      setBusy(false);
    }
  }
  async function delSkill(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "删除失败" });
        return;
      }
      setMsg({ type: "ok", text: `技能 ${id} 已删除` });
      await loadAll();
    } finally {
      setBusy(false);
    }
  }

  const filteredJobs = jobs.filter(
    (j) => !jobFilter || j.title.toLowerCase().includes(jobFilter.toLowerCase()) || j.id.includes(jobFilter.toLowerCase())
  );
  const filteredSkills = skills.filter(
    (s) => !skillFilter || s.name.toLowerCase().includes(skillFilter.toLowerCase()) || s.id.includes(skillFilter.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div className="max-w-6xl mx-auto p-6">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">职途 · 后台</h1>
            <p className="text-sm text-slate-500">
              直接编辑 SQLite 中的岗位 / 技能数据。保存即写入 career.db，重启服务不会覆盖你的改动
              （数据版本号不变时不会重新种子化）。
            </p>
            <p className="mt-1 text-xs text-slate-400">
              已在运行中的「职途」页面需要在打开后刷新，才会重新拉取知识库并看到新数据。
              若想恢复出厂数据：删除 career.db 后重启，会自动按 data/*.json 重新种子化。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadAll}
              disabled={busy}
              className="px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-sm disabled:opacity-50"
            >
              {loading ? "刷新中…" : "刷新"}
            </button>
            <a href="/" className="px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 text-sm">
              返回产品 →
            </a>
          </div>
        </header>

        {msg && (
          <div
            role="status"
            className={`mb-4 flex items-start justify-between gap-3 px-3 py-2 rounded text-sm ${
              msg.type === "ok" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
            }`}
          >
            <span>{msg.text}</span>
            <button
              onClick={() => setMsg(null)}
              aria-label="关闭提示"
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-300 mb-4">
          {(["jobs", "skills"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setMsg(null);
                setDelTarget(null);
              }}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "jobs" ? `岗位 (${jobs.length})` : `技能 (${skills.length})`}
            </button>
          ))}
        </div>

        {/* ============ 岗位 ============ */}
        {tab === "jobs" && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <input
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
                placeholder="搜索岗位标题 / id"
                className="flex-1 px-3 py-1.5 border border-slate-300 rounded text-sm"
              />
              <button
                onClick={() => openJob(null)}
                className="px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 text-sm whitespace-nowrap"
              >
                + 新建岗位
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="p-2">id</th>
                    <th className="p-2">标题</th>
                    <th className="p-2">方向</th>
                    <th className="p-2">核心技能</th>
                    <th className="p-2">实习/初级</th>
                    <th className="p-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-slate-400">
                        加载中…
                      </td>
                    </tr>
                  )}
                  {!loading && filteredJobs.map((j) => (
                    <tr key={j.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2 font-mono text-xs text-slate-500">{j.id}</td>
                      <td className="p-2 font-medium">{j.title}</td>
                      <td className="p-2 text-slate-600">{trackName(j.track)}</td>
                      <td className="p-2 text-slate-600">{(j.core || []).length} 项</td>
                      <td className="p-2 text-slate-600 text-xs">
                        {j.salary?.intern || "—"} / {j.salary?.junior || "—"}
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">
                        {delTarget?.kind === "job" && delTarget.id === j.id ? (
                          <span className="text-xs text-red-700">
                            不可恢复，确认删除？
                            <button
                              onClick={() => delJob(j.id)}
                              disabled={busy}
                              className="ml-2 font-semibold text-red-600 underline disabled:opacity-50"
                            >
                              确认删除
                            </button>
                            <button
                              onClick={() => setDelTarget(null)}
                              disabled={busy}
                              className="ml-2 text-slate-500 underline disabled:opacity-50"
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <span>
                            <button onClick={() => openJob(j)} className="text-blue-600 hover:underline mr-3">
                              编辑
                            </button>
                            <button
                              onClick={() => setDelTarget({ kind: "job", id: j.id })}
                              className="text-red-600 hover:underline"
                            >
                              删除
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && filteredJobs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center">
                        <div className="text-sm text-slate-500">
                          {jobs.length === 0
                            ? "知识库还没有岗位。点右上角「+ 新建岗位」录入第一个岗位。"
                            : `没有匹配「${jobFilter}」的岗位，试试别的关键词。`}
                        </div>
                        {jobs.length > 0 && jobFilter && (
                          <button
                            onClick={() => setJobFilter("")}
                            className="mt-1 text-xs text-blue-600 hover:underline"
                          >
                            清除筛选
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {jobOpen && (
              <JobEditor
                form={jobForm}
                setForm={setJobForm}
                isNew={!editingJobId}
                tracks={tracks}
                skills={skills}
                skillName={skillName}
                setCore={setCore}
                busy={busy}
                onCancel={() => setJobOpen(false)}
                onSave={saveJob}
              />
            )}
          </section>
        )}

        {/* ============ 技能 ============ */}
        {tab === "skills" && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <input
                value={skillFilter}
                onChange={(e) => setSkillFilter(e.target.value)}
                placeholder="搜索技能名称 / id"
                className="flex-1 px-3 py-1.5 border border-slate-300 rounded text-sm"
              />
              <button
                onClick={() => openSkill(null)}
                className="px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 text-sm whitespace-nowrap"
              >
                + 新建技能
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="p-2">id</th>
                    <th className="p-2">名称</th>
                    <th className="p-2">分类</th>
                    <th className="p-2">学时</th>
                    <th className="p-2">资源</th>
                    <th className="p-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-slate-400">
                        加载中…
                      </td>
                    </tr>
                  )}
                  {!loading && filteredSkills.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2 font-mono text-xs text-slate-500">{s.id}</td>
                      <td className="p-2 font-medium">{s.name}</td>
                      <td className="p-2 text-slate-600">{s.category || "—"}</td>
                      <td className="p-2 text-slate-600">{s.estHours}h</td>
                      <td className="p-2 text-slate-600">{(s.resources || []).length} 项</td>
                      <td className="p-2 text-right whitespace-nowrap">
                        {delTarget?.kind === "skill" && delTarget.id === s.id ? (
                          <span className="text-xs text-red-700">
                            不可恢复，确认删除？
                            <button
                              onClick={() => delSkill(s.id)}
                              disabled={busy}
                              className="ml-2 font-semibold text-red-600 underline disabled:opacity-50"
                            >
                              确认删除
                            </button>
                            <button
                              onClick={() => setDelTarget(null)}
                              disabled={busy}
                              className="ml-2 text-slate-500 underline disabled:opacity-50"
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <span>
                            <button onClick={() => openSkill(s)} className="text-blue-600 hover:underline mr-3">
                              编辑
                            </button>
                            <button
                              onClick={() => setDelTarget({ kind: "skill", id: s.id })}
                              className="text-red-600 hover:underline"
                            >
                              删除
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && filteredSkills.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center">
                        <div className="text-sm text-slate-500">
                          {skills.length === 0
                            ? "知识库还没有技能。点右上角「+ 新建技能」录入第一个技能。"
                            : `没有匹配「${skillFilter}」的技能，试试别的关键词。`}
                        </div>
                        {skills.length > 0 && skillFilter && (
                          <button
                            onClick={() => setSkillFilter("")}
                            className="mt-1 text-xs text-blue-600 hover:underline"
                          >
                            清除筛选
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {skillOpen && (
              <SkillEditor
                form={skillForm}
                setForm={setSkillForm}
                isNew={!editingSkillId}
                setRes={setRes}
                busy={busy}
                onCancel={() => setSkillOpen(false)}
                onSave={saveSkill}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/* ============ 岗位编辑器 ============ */
function JobEditor({
  form,
  setForm,
  isNew,
  tracks,
  skills,
  skillName,
  setCore,
  busy,
  onCancel,
  onSave,
}: {
  form: JobForm;
  setForm: (f: JobForm) => void;
  isNew: boolean;
  tracks: TrackRow[];
  skills: SkillRow[];
  skillName: (id: string) => string;
  setCore: (i: number, patch: Partial<{ s: string; w: number }>) => void;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [errs, setErrs] = useState<string[]>([]);

  function trySave() {
    const list: string[] = [];
    const id = form.id.trim();
    if (!id) list.push("岗位 id 不能为空");
    else if (!ID_RE.test(id))
      list.push("id 只能以小写字母/数字开头，且只能包含小写字母 / 数字 / 连字符");
    if (!form.title.trim()) list.push("标题不能为空");
    if (!form.track) list.push("请选择所属方向");
    const filledCore = form.core.filter((c) => c.s.trim());
    if (filledCore.length === 0) list.push("至少为岗位选择 1 项核心技能");
    if (list.length) {
      setErrs(list);
      return;
    }
    setErrs([]);
    onSave();
  }

  return (
    <div className="mt-4 p-4 border border-slate-300 rounded bg-white">
      <h2 className="font-semibold mb-3">{isNew ? "新建岗位" : `编辑岗位 · ${form.id}`}</h2>
      <FieldErrors errors={errs} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">
          岗位 id（唯一）
          <span className="block text-xs font-normal text-slate-400">
            小写字母 / 数字 / 连字符，用于前端识别
          </span>
          <input
            value={form.id}
            disabled={!isNew}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded disabled:bg-slate-100 font-mono text-xs"
          />
        </label>
        <label className="text-sm">
          标题
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
          />
        </label>
        <label className="text-sm">
          方向
          <select
            value={form.track}
            onChange={(e) => setForm({ ...form, track: e.target.value })}
            className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
          >
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          入职门槛 (threshold)
          <input
            value={form.threshold}
            onChange={(e) => setForm({ ...form, threshold: e.target.value })}
            className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
          />
        </label>
        <label className="text-sm">
          实习薪资
          <input
            value={form.intern}
            onChange={(e) => setForm({ ...form, intern: e.target.value })}
            className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
          />
        </label>
        <label className="text-sm">
          初级薪资
          <input
            value={form.junior}
            onChange={(e) => setForm({ ...form, junior: e.target.value })}
            className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
          />
        </label>
      </div>

      <label className="text-sm block mt-3">
        一句话简介 (summary)
        <textarea
          value={form.summary}
          onChange={(e) => setForm({ ...form, summary: e.target.value })}
          rows={2}
          className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
        />
      </label>
      <label className="text-sm block mt-3">
        发展空间 (growth)
        <textarea
          value={form.growth}
          onChange={(e) => setForm({ ...form, growth: e.target.value })}
          rows={2}
          className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
        />
      </label>
      <label className="text-sm block mt-3">
        证书 (certs，逗号分隔)
        <input
          value={form.certsText}
          onChange={(e) => setForm({ ...form, certsText: e.target.value })}
          className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
        />
      </label>
      <label className="text-sm block mt-3">
        加分技能 (plus，逗号分隔的技能 id)
        <input
          value={form.plusText}
          onChange={(e) => setForm({ ...form, plusText: e.target.value })}
          className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-xs"
        />
      </label>

      <div className="mt-3">
        <div className="text-sm font-medium mb-1">核心技能 (core，权重 3=硬门槛 / 2=重要 / 1=加分)</div>
        <div className="space-y-1">
          {form.core.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={c.s}
                onChange={(e) => setCore(i, { s: e.target.value })}
                className="flex-1 px-2 py-1.5 border border-slate-300 rounded text-sm"
              >
                <option value="">— 选择技能 —</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </select>
              <select
                value={c.w}
                onChange={(e) => setCore(i, { w: Number(e.target.value) })}
                className="px-2 py-1.5 border border-slate-300 rounded text-sm"
              >
                {[3, 2, 1].map((w) => (
                  <option key={w} value={w}>
                    {WEIGHT_LABEL[w]}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setForm({ ...form, core: form.core.filter((_, idx) => idx !== i) })}
                className="text-red-600 hover:underline text-sm px-2"
              >
                移除
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setForm({ ...form, core: [...form.core, { s: "", w: 3 }] })}
          className="mt-2 text-sm text-blue-600 hover:underline"
        >
          + 添加核心技能
        </button>
      </div>

      <div className="flex gap-2 mt-4">
        <button
          onClick={trySave}
          disabled={busy}
          className="px-4 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 text-sm disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-sm disabled:opacity-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}

/* ============ 技能编辑器 ============ */
function SkillEditor({
  form,
  setForm,
  isNew,
  setRes,
  busy,
  onCancel,
  onSave,
}: {
  form: SkillForm;
  setForm: (f: SkillForm) => void;
  isNew: boolean;
  setRes: (i: number, patch: Partial<{ title: string; platform: string }>) => void;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [errs, setErrs] = useState<string[]>([]);

  function trySave() {
    const list: string[] = [];
    const id = form.id.trim();
    if (!id) list.push("技能 id 不能为空");
    else if (!ID_RE.test(id))
      list.push("id 只能以小写字母/数字开头，且只能包含小写字母 / 数字 / 连字符");
    if (!form.name.trim()) list.push("名称不能为空");
    if (Number(form.estHours) < 0 || Number.isNaN(Number(form.estHours)))
      list.push("估算学时需为非负数字");
    if (list.length) {
      setErrs(list);
      return;
    }
    setErrs([]);
    onSave();
  }

  return (
    <div className="mt-4 p-4 border border-slate-300 rounded bg-white">
      <h2 className="font-semibold mb-3">{isNew ? "新建技能" : `编辑技能 · ${form.id}`}</h2>
      <FieldErrors errors={errs} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">
          技能 id（唯一）
          <span className="block text-xs font-normal text-slate-400">
            小写字母 / 数字 / 连字符，用于自动识别与前端引用
          </span>
          <input
            value={form.id}
            disabled={!isNew}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded disabled:bg-slate-100 font-mono text-xs"
          />
        </label>
        <label className="text-sm">
          名称
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
          />
        </label>
        <label className="text-sm">
          分类 (category)
          <input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
          />
        </label>
        <label className="text-sm">
          估算学时 (estHours)
          <span className="block text-xs font-normal text-slate-400">
            学完的大致小时数，用于缺口与路径估算
          </span>
          <input
            value={form.estHours}
            onChange={(e) => setForm({ ...form, estHours: e.target.value })}
            type="number"
            min={0}
            className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
          />
        </label>
      </div>

      <label className="text-sm block mt-3">
        别名 (aliases，逗号分隔，用于自动识别)
        <input
          value={form.aliasesText}
          onChange={(e) => setForm({ ...form, aliasesText: e.target.value })}
          className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded"
        />
      </label>

      <div className="mt-3">
        <div className="text-sm font-medium mb-1">学习资源 (resources)</div>
        <div className="space-y-1">
          {form.resources.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={r.title}
                onChange={(e) => setRes(i, { title: e.target.value })}
                placeholder="标题"
                className="flex-1 px-2 py-1.5 border border-slate-300 rounded text-sm"
              />
              <input
                value={r.platform}
                onChange={(e) => setRes(i, { platform: e.target.value })}
                placeholder="平台"
                className="w-32 px-2 py-1.5 border border-slate-300 rounded text-sm"
              />
              <button
                onClick={() => setForm({ ...form, resources: form.resources.filter((_, idx) => idx !== i) })}
                className="text-red-600 hover:underline text-sm px-2"
              >
                移除
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setForm({ ...form, resources: [...form.resources, { title: "", platform: "" }] })}
          className="mt-2 text-sm text-blue-600 hover:underline"
        >
          + 添加资源
        </button>
      </div>

      <div className="flex gap-2 mt-4">
        <button
          onClick={trySave}
          disabled={busy}
          className="px-4 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 text-sm disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-sm disabled:opacity-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}
