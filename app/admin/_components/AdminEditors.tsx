"use client";

import { useState } from "react";

/* ---------- 类型 ---------- */
export type JobRow = {
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
export type SkillRow = {
  id: string;
  name: string;
  category: string;
  aliases: string[];
  estHours: number;
  resources: { title: string; platform: string }[];
};
export type TrackRow = { id: string; name: string };

/* ---------- 表单草稿 ---------- */
export type JobForm = {
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
export type SkillForm = {
  id: string;
  name: string;
  category: string;
  aliasesText: string;
  estHours: string;
  resources: { title: string; platform: string }[];
};

const WEIGHT_LABEL: Record<number, string> = { 1: "1·加分", 2: "2·重要", 3: "3·硬门槛" };

const ID_RE = /^[a-z0-9][a-z0-9\-]*$/;

export function FieldErrors({ errors }: { errors: string[] }) {
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

/* ============ 岗位编辑器 ============ */
export function JobEditor({
  form,
  setForm,
  isNew,
  tracks,
  skills,
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
export function SkillEditor({
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
    const hours = Number(form.estHours);
    if (!form.estHours.trim() || !Number.isFinite(hours) || hours <= 0)
      list.push("估算学时需填写大于 0 的数字，不能为 0、空值或负数");
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
