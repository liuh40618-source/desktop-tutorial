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
      setMsg({ type: "error", text: data.error || "保存失败" });
      return;
    }
    setMsg({ type: "ok", text: isNew ? `岗位 ${payload.id} 已创建` : `岗位 ${payload.id} 已更新` });
    setJobOpen(false);
    await loadAll();
  }
  async function delJob(id: string) {
    if (!confirm(`确认删除岗位 ${id}？该操作不可撤销。`)) return;
    const res = await fetch(`/api/admin/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setMsg({ type: "error", text: data.error || "删除失败" });
      return;
    }
    setMsg({ type: "ok", text: `岗位 ${id} 已删除` });
    await loadAll();
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
    const isNew = !editingSkillId;
    const payload = {
      id: skillForm.id.trim(),
      name: skillForm.name.trim(),
      category: skillForm.category,
      aliases: skillForm.aliasesText.split(",").map((s) => s.trim()).filter(Boolean),
      estHours: Number(skillForm.estHours) || 0,
      resources: skillForm.resources.filter((r) => r.title || r.platform).map((r) => ({ ...r })),
    };
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
      setMsg({ type: "error", text: data.error || "保存失败" });
      return;
    }
    setMsg({ type: "ok", text: isNew ? `技能 ${payload.id} 已创建` : `技能 ${payload.id} 已更新` });
    setSkillOpen(false);
    await loadAll();
  }
  async function delSkill(id: string) {
    if (!confirm(`确认删除技能 ${id}？该操作不可撤销。`)) return;
    const res = await fetch(`/api/admin/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setMsg({ type: "error", text: data.error || "删除失败" });
      return;
    }
    setMsg({ type: "ok", text: `技能 ${id} 已删除` });
    await loadAll();
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
            <p className="text-sm text-slate-500">直接编辑 SQLite 中的岗位 / 技能数据，前端刷新即生效。</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadAll} className="px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-sm">
              刷新
            </button>
            <a href="/" className="px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 text-sm">
              返回产品 →
            </a>
          </div>
        </header>

        {msg && (
          <div
            className={`mb-4 px-3 py-2 rounded text-sm ${
              msg.type === "ok" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-300 mb-4">
          {(["jobs", "skills"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
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
                        <button onClick={() => openJob(j)} className="text-blue-600 hover:underline mr-3">
                          编辑
                        </button>
                        <button onClick={() => delJob(j.id)} className="text-red-600 hover:underline">
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && filteredJobs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-slate-400">
                        无匹配岗位
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
                        <button onClick={() => openSkill(s)} className="text-blue-600 hover:underline mr-3">
                          编辑
                        </button>
                        <button onClick={() => delSkill(s.id)} className="text-red-600 hover:underline">
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && filteredSkills.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-slate-400">
                        无匹配技能
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
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-4 p-4 border border-slate-300 rounded bg-white">
      <h2 className="font-semibold mb-3">{isNew ? "新建岗位" : `编辑岗位 · ${form.id}`}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">
          岗位 id（唯一）
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
        <button onClick={onSave} className="px-4 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 text-sm">
          保存
        </button>
        <button onClick={onCancel} className="px-4 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-sm">
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
  onCancel,
  onSave,
}: {
  form: SkillForm;
  setForm: (f: SkillForm) => void;
  isNew: boolean;
  setRes: (i: number, patch: Partial<{ title: string; platform: string }>) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-4 p-4 border border-slate-300 rounded bg-white">
      <h2 className="font-semibold mb-3">{isNew ? "新建技能" : `编辑技能 · ${form.id}`}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">
          技能 id（唯一）
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
        <button onClick={onSave} className="px-4 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 text-sm">
          保存
        </button>
        <button onClick={onCancel} className="px-4 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-sm">
          取消
        </button>
      </div>
    </div>
  );
}
