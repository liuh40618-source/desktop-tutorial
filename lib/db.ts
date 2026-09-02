/**
 * 数据层（服务端，仅 Node 运行时可用）
 *
 * 用 Node 22 内置的 node:sqlite 作为轻量数据库，替代原先的静态 JSON 直接 import。
 * 设计要点：
 *  - career.db 是单一数据源；首次运行从 data/*.json 种子化，之后所有读取走 DB。
 *  - 知识库（岗位 / 技能 / 方向）落在 SQLite，前端通过 /api/knowledge 取数后在浏览器本地计算。
 *  - 整个过程零 LLM、零外部 API——产品是完全非 AI 的。
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "career.db");

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (_db) return _db;
  const conn = new DatabaseSync(DB_PATH);
  conn.exec("PRAGMA journal_mode = WAL;");
  conn.exec("PRAGMA foreign_keys = ON;");
  migrate(conn);
  seedIfEmpty(conn);
  _db = conn;
  return _db;
}

function migrate(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id            TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      track        TEXT NOT NULL,
      summary      TEXT,
      core         TEXT NOT NULL,   -- JSON: [{s, w}]
      plus         TEXT,            -- JSON: string[]
      threshold    TEXT,
      salary_intern TEXT,
      salary_junior TEXT,
      certs        TEXT,
      growth       TEXT
    );
    CREATE TABLE IF NOT EXISTS skills (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      category  TEXT,
      aliases   TEXT NOT NULL,     -- JSON: string[]
      estHours  INTEGER NOT NULL,
      resources TEXT NOT NULL      -- JSON: [{title, platform}]
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_profile (
      key          TEXT PRIMARY KEY,
      name         TEXT NOT NULL DEFAULT '',
      step         INTEGER NOT NULL,
      started      INTEGER NOT NULL,
      profile      TEXT NOT NULL,
      selected_job TEXT NOT NULL,
      done_skills  TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_plans (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      major      TEXT,
      job_title  TEXT,
      summary    TEXT,
      markdown   TEXT
    );
  `);
  // 兼容旧库：早期 user_profile 无 name 列，CREATE TABLE IF NOT EXISTS 不会改动已有表
  const cols = (d.prepare("PRAGMA table_info(user_profile)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!cols.includes("name")) {
    d.exec("ALTER TABLE user_profile ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  // 兼容旧库：user_plans 无 name 列（记录命名管理）
  const planCols = (d.prepare("PRAGMA table_info(user_plans)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!planCols.includes("name")) {
    d.exec("ALTER TABLE user_plans ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
}

function seedIfEmpty(d: DatabaseSync) {
  const jobsJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "jobs.json"), "utf-8")
  );
  const skillsJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "skills.json"), "utf-8")
  );

  const count = (d.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n;
  const metaRow = d.prepare("SELECT value FROM meta WHERE key = 'jobs_meta'").get() as
    | { value: string }
    | undefined;
  const storedVersion = metaRow ? JSON.parse(metaRow.value).version : "";

  // 首次运行（count===0）或数据版本升级时，清掉岗位/技能/方向并重新种子化。
  // 注意：绝不触碰 user_profile / user_plans，用户态数据要保留。
  if (count > 0 && storedVersion === (jobsJson._meta?.version ?? "")) return;
  if (count > 0) {
    d.exec("DELETE FROM jobs; DELETE FROM skills; DELETE FROM tracks;");
  }

  const insertTrack = d.prepare("INSERT OR REPLACE INTO tracks (id, name) VALUES (?, ?)");
  for (const t of jobsJson.tracks) insertTrack.run(t.id, t.name);

  const insertJob = d.prepare(
    `INSERT OR REPLACE INTO jobs
       (id, title, track, summary, core, plus, threshold, salary_intern, salary_junior, certs, growth)
     VALUES (@id, @title, @track, @summary, @core, @plus, @threshold, @salary_intern, @salary_junior, @certs, @growth)`
  );
  for (const j of jobsJson.jobs) {
    insertJob.run({
      id: j.id,
      title: j.title,
      track: j.track,
      summary: j.summary ?? "",
      core: JSON.stringify(j.core ?? []),
      plus: JSON.stringify(j.plus ?? []),
      threshold: j.threshold ?? "",
      salary_intern: j.salary?.intern ?? "",
      salary_junior: j.salary?.junior ?? "",
      certs: JSON.stringify(j.certs ?? []),
      growth: j.growth ?? "",
    });
  }

  const insertSkill = d.prepare(
    `INSERT OR REPLACE INTO skills
       (id, name, category, aliases, estHours, resources)
     VALUES (@id, @name, @category, @aliases, @estHours, @resources)`
  );
  for (const s of skillsJson.skills) {
    insertSkill.run({
      id: s.id,
      name: s.name,
      category: s.category ?? "",
      aliases: JSON.stringify(s.aliases ?? []),
      estHours: s.estHours ?? 0,
      resources: JSON.stringify(s.resources ?? []),
    });
  }

  const setMeta = d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
  setMeta.run("jobs_meta", JSON.stringify(jobsJson._meta ?? {}));
  setMeta.run("skills_meta", JSON.stringify(skillsJson._meta ?? {}));
}

export interface KnowledgeBase {
  jobs: any[];
  skills: any[];
  tracks: { id: string; name: string }[];
  meta: { version: string; note: string; salaryNote: string };
}

/** 一次性返回整库知识库，供前端注入 matcher 后在本地计算 */
export function getKnowledgeBase(): KnowledgeBase {
  const d = db();
  const jobs = (d.prepare("SELECT * FROM jobs").all() as any[]).map((r) => ({
    id: r.id,
    title: r.title,
    track: r.track,
    summary: r.summary,
    core: JSON.parse(r.core),
    plus: JSON.parse(r.plus || "[]"),
    threshold: r.threshold,
    salary: { intern: r.salary_intern, junior: r.salary_junior },
    certs: JSON.parse(r.certs || "[]"),
    growth: r.growth,
  }));
  const skills = (d.prepare("SELECT * FROM skills").all() as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    aliases: JSON.parse(r.aliases),
    estHours: r.estHours,
    resources: JSON.parse(r.resources),
  }));
  const tracks = d.prepare("SELECT id, name FROM tracks").all() as { id: string; name: string }[];
  const metaRow = d.prepare("SELECT value FROM meta WHERE key = 'jobs_meta'").get() as
    | { value: string }
    | undefined;
  const meta = metaRow ? JSON.parse(metaRow.value) : { version: "?", note: "", salaryNote: "" };
  return { jobs, skills, tracks, meta };
}

/* ============================================================
   用户态（运行时写入，让数据库真正"用起来"）
   单用户本地场景：user_profile 固定一行 key='local'
   ============================================================ */
export interface ProfileRow {
  id: string;
  name: string;
  step: number;
  started: boolean;
  profile: any;
  selectedJobId: string;
  doneSkills: string[];
  updatedAt: string;
}

export function listProfiles(): ProfileRow[] {
  const d = db();
  return (
    d
      .prepare(
        "SELECT key, name, step, started, profile, selected_job, done_skills, updated_at FROM user_profile ORDER BY updated_at DESC"
      )
      .all() as any[]
  ).map((r) => ({
    id: r.key,
    name: r.name,
    step: r.step,
    started: !!r.started,
    profile: JSON.parse(r.profile),
    selectedJobId: r.selected_job,
    doneSkills: JSON.parse(r.done_skills || "[]"),
    updatedAt: r.updated_at,
  }));
}

export function getUserProfile(id = "local"): ProfileRow | null {
  const d = db();
  const row = d.prepare("SELECT * FROM user_profile WHERE key = ?").get(id) as any;
  if (!row) return null;
  return {
    id: row.key,
    name: row.name,
    step: row.step,
    started: !!row.started,
    profile: JSON.parse(row.profile),
    selectedJobId: row.selected_job,
    doneSkills: JSON.parse(row.done_skills || "[]"),
    updatedAt: row.updated_at,
  };
}

export function saveUserProfile(p: ProfileRow) {
  const d = db();
  d.prepare(
    `INSERT OR REPLACE INTO user_profile
       (key, name, step, started, profile, selected_job, done_skills, updated_at)
     VALUES (@key, @name, @step, @started, @profile, @selected_job, @done_skills, @updated_at)`
  ).run({
    key: p.id,
    name: p.name ?? "",
    step: p.step,
    started: p.started ? 1 : 0,
    profile: JSON.stringify(p.profile ?? {}),
    selected_job: p.selectedJobId ?? "",
    done_skills: JSON.stringify(p.doneSkills ?? []),
    updated_at: new Date().toISOString(),
  });
}

export function deleteUserProfile(id: string) {
  const d = db();
  d.prepare("DELETE FROM user_profile WHERE key = ?").run(id);
}

export interface PlanRow {
  id: string;
  name: string;
  createdAt: number;
  major: string;
  jobTitle: string;
  summary: string;
  markdown: string;
}

export function listPlans(): PlanRow[] {
  const d = db();
  return (
    d
      .prepare(
        "SELECT id, name, created_at, major, job_title, summary, markdown FROM user_plans ORDER BY created_at DESC LIMIT 50"
      )
      .all() as any[]
  ).map((r) => ({
    id: r.id,
    name: r.name ?? "",
    createdAt: r.created_at,
    major: r.major,
    jobTitle: r.job_title,
    summary: r.summary,
    markdown: r.markdown,
  }));
}

export function addPlanRec(rec: PlanRow) {
  const d = db();
  d.prepare(
    `INSERT OR REPLACE INTO user_plans
       (id, name, created_at, major, job_title, summary, markdown)
     VALUES (@id, @name, @created_at, @major, @job_title, @summary, @markdown)`
  ).run({
    id: rec.id,
    name: rec.name ?? "",
    created_at: rec.createdAt,
    major: rec.major ?? "",
    job_title: rec.jobTitle ?? "",
    summary: rec.summary ?? "",
    markdown: rec.markdown ?? "",
  });
}

export function deletePlanRec(id: string) {
  const d = db();
  d.prepare("DELETE FROM user_plans WHERE id = ?").run(id);
}

/* ============================================================
   后台编辑：岗位 / 技能 的写入接口（直接改 SQLite）
   仅知识库表（jobs/skills/tracks/meta），绝不触碰 user_profile / user_plans。
   要点：jobs_meta 版本保持与 data/*.json 一致（2.0），
   所以 seedIfEmpty 在重启时不会覆盖这些手动编辑。
   ============================================================ */

export interface JobInput {
  id: string;
  title: string;
  track: string;
  summary?: string;
  core?: { s: string; w: number }[];
  plus?: string[];
  threshold?: string;
  salary?: { intern?: string; junior?: string };
  certs?: string[];
  growth?: string;
}

export interface SkillInput {
  id: string;
  name: string;
  category?: string;
  aliases?: string[];
  estHours?: number;
  resources?: { title: string; platform: string }[];
}

export function allSkillIds(): string[] {
  return (db().prepare("SELECT id FROM skills").all() as { id: string }[]).map((r) => r.id);
}

export function allTrackIds(): string[] {
  return (db().prepare("SELECT id FROM tracks").all() as { id: string }[]).map((r) => r.id);
}

export function getJobById(id: string) {
  const r = db().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    track: r.track,
    summary: r.summary,
    core: JSON.parse(r.core),
    plus: JSON.parse(r.plus || "[]"),
    threshold: r.threshold,
    salary: { intern: r.salary_intern, junior: r.salary_junior },
    certs: JSON.parse(r.certs || "[]"),
    growth: r.growth,
  };
}

export function upsertJob(job: JobInput) {
  const d = db();
  d.prepare(
    `INSERT OR REPLACE INTO jobs
       (id, title, track, summary, core, plus, threshold, salary_intern, salary_junior, certs, growth)
     VALUES (@id, @title, @track, @summary, @core, @plus, @threshold, @salary_intern, @salary_junior, @certs, @growth)`
  ).run({
    id: job.id,
    title: job.title,
    track: job.track,
    summary: job.summary ?? "",
    core: JSON.stringify(job.core ?? []),
    plus: JSON.stringify(job.plus ?? []),
    threshold: job.threshold ?? "",
    salary_intern: job.salary?.intern ?? "",
    salary_junior: job.salary?.junior ?? "",
    certs: JSON.stringify(job.certs ?? []),
    growth: job.growth ?? "",
  });
}

export function deleteJob(id: string) {
  db().prepare("DELETE FROM jobs WHERE id = ?").run(id);
}

export function getSkillById(id: string) {
  const r = db().prepare("SELECT * FROM skills WHERE id = ?").get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    aliases: JSON.parse(r.aliases),
    estHours: r.estHours,
    resources: JSON.parse(r.resources),
  };
}

export function upsertSkill(skill: SkillInput) {
  const d = db();
  d.prepare(
    `INSERT OR REPLACE INTO skills (id, name, category, aliases, estHours, resources)
     VALUES (@id, @name, @category, @aliases, @estHours, @resources)`
  ).run({
    id: skill.id,
    name: skill.name,
    category: skill.category ?? "",
    aliases: JSON.stringify(skill.aliases ?? []),
    estHours: skill.estHours ?? 0,
    resources: JSON.stringify(skill.resources ?? []),
  });
}

export function deleteSkill(id: string) {
  db().prepare("DELETE FROM skills WHERE id = ?").run(id);
}

/** 校验岗位提交：id 合法、方向存在、core/plus 引用的技能存在、权重∈{1,2,3} */
export function validateJobInput(body: any): { ok: true; job: JobInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "请求体必须是对象" };
  const id = String(body.id ?? "").trim();
  const title = String(body.title ?? "").trim();
  const track = String(body.track ?? "").trim();
  if (!id) return { ok: false, error: "岗位 id 不能为空" };
  if (!/^[a-z0-9][a-z0-9\-]*$/.test(id)) return { ok: false, error: "id 只能以小写字母/数字开头，仅含小写字母/数字/连字符" };
  if (!title) return { ok: false, error: "岗位标题不能为空" };
  const trackIds = new Set(allTrackIds());
  if (!trackIds.has(track)) return { ok: false, error: `方向不存在: ${track}` };
  const skillIds = new Set(allSkillIds());
  const core = Array.isArray(body.core) ? body.core : [];
  for (const c of core) {
    const s = String(c?.s ?? "").trim();
    const w = Number(c?.w);
    if (!s) return { ok: false, error: "核心技能存在空 id" };
    if (!skillIds.has(s)) return { ok: false, error: `核心技能不存在: ${s}` };
    if (![1, 2, 3].includes(w)) return { ok: false, error: `核心技能权重必须为 1/2/3，收到: ${w}` };
  }
  const plus = Array.isArray(body.plus) ? body.plus.map(String) : [];
  for (const p of plus) if (!skillIds.has(p)) return { ok: false, error: `加分技能不存在: ${p}` };
  const job: JobInput = {
    id,
    title,
    track,
    summary: String(body.summary ?? ""),
    core: core.map((c: any) => ({ s: String(c.s).trim(), w: Number(c.w) })),
    plus,
    threshold: String(body.threshold ?? ""),
    salary: { intern: String(body.salary?.intern ?? ""), junior: String(body.salary?.junior ?? "") },
    certs: Array.isArray(body.certs) ? body.certs.map(String) : [],
    growth: String(body.growth ?? ""),
  };
  return { ok: true, job };
}

/** 校验技能提交：id/name 非空、estHours 为非负数字、aliases/resources 为数组 */
export function validateSkillInput(body: any): { ok: true; skill: SkillInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "请求体必须是对象" };
  const id = String(body.id ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!id) return { ok: false, error: "技能 id 不能为空" };
  if (!/^[a-z0-9][a-z0-9\-]*$/.test(id)) return { ok: false, error: "id 只能以小写字母/数字开头，仅含小写字母/数字/连字符" };
  if (!name) return { ok: false, error: "技能名称不能为空" };
  const estHours = Number(body.estHours ?? 0);
  if (!Number.isFinite(estHours) || estHours < 0) return { ok: false, error: "estHours 必须为非负数字" };
  const aliases = Array.isArray(body.aliases) ? body.aliases.map(String) : [];
  const resources = Array.isArray(body.resources)
    ? body.resources.map((r: any) => ({ title: String(r?.title ?? ""), platform: String(r?.platform ?? "") }))
    : [];
  const skill: SkillInput = {
    id,
    name,
    category: String(body.category ?? ""),
    aliases,
    estHours,
    resources,
  };
  return { ok: true, skill };
}
