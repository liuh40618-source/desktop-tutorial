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
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { confidenceForSampleSize } from "./confidence.mjs";
import type { Profile, WorkTag, WorkflowState } from "./types";

const DB_PATH = process.env.CAREER_DB_PATH
  ? path.resolve(process.env.CAREER_DB_PATH)
  : path.join(process.cwd(), "career.db");

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new DatabaseSync(DB_PATH);
  conn.exec("PRAGMA journal_mode = WAL;");
  conn.exec("PRAGMA foreign_keys = ON;");
  migrate(conn);
  seedIfEmpty(conn);
  _db = conn;
  return _db;
}

/** Readiness probe used by container and reverse-proxy health checks. */
export function checkDatabaseHealth(): void {
  db().prepare("SELECT 1").get();
}

/**
 * 与现有 `PRAGMA table_info` + `ALTER TABLE ... ADD COLUMN` + 单列 try/catch 语义完全一致，
 * 仅抽掉重复样板：某列失败不影响其它列与既有数据。
 */
function ensureColumns(d: DatabaseSync, table: string, specs: [string, string][]) {
  const cols = new Set(
    (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
  );
  for (const [name, ddl] of specs) {
    if (cols.has(name)) continue;
    try {
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    } catch {
      /* 单列失败不影响其它列与既有数据 */
    }
  }
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
      owner_id     TEXT NOT NULL DEFAULT 'legacy-local',
      name         TEXT NOT NULL DEFAULT '',
      step         INTEGER NOT NULL,
      started      INTEGER NOT NULL,
      profile      TEXT NOT NULL,
      workflow     TEXT NOT NULL DEFAULT 'null',
      selected_job TEXT NOT NULL,
      done_skills  TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_plans (
      id         TEXT PRIMARY KEY,
      owner_id   TEXT NOT NULL DEFAULT 'legacy-local',
      name       TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      major      TEXT,
      job_title  TEXT,
      summary    TEXT,
      markdown   TEXT
    );
    CREATE TABLE IF NOT EXISTS user_jds (
      id         TEXT PRIMARY KEY,
      owner_id   TEXT NOT NULL DEFAULT 'legacy-local',
      title      TEXT NOT NULL DEFAULT '',
      raw        TEXT NOT NULL DEFAULT '',
      skills     TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
  `);
  // 兼容旧库：早期 user_profile 无 name 列，CREATE TABLE IF NOT EXISTS 不会改动已有表
  const cols = (d.prepare("PRAGMA table_info(user_profile)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!cols.includes("name")) {
    d.exec("ALTER TABLE user_profile ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes("owner_id")) {
    d.exec("ALTER TABLE user_profile ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy-local'");
  }
  if (!cols.includes("workflow")) {
    d.exec("ALTER TABLE user_profile ADD COLUMN workflow TEXT NOT NULL DEFAULT 'null'");
  }
  // 兼容旧库：user_plans 无 name 列（记录命名管理）
  const planCols = (d.prepare("PRAGMA table_info(user_plans)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!planCols.includes("name")) {
    d.exec("ALTER TABLE user_plans ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  if (!planCols.includes("owner_id")) {
    d.exec("ALTER TABLE user_plans ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy-local'");
  }
  const jdCols = (d.prepare("PRAGMA table_info(user_jds)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!jdCols.includes("owner_id")) {
    d.exec("ALTER TABLE user_jds ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy-local'");
  }
  d.exec(`
    CREATE INDEX IF NOT EXISTS user_plans_owner_created_idx ON user_plans(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS user_jds_owner_created_idx ON user_jds(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS user_profile_owner_updated_idx ON user_profile(owner_id, updated_at DESC);
  `);
  // 兼容旧库：skills 表缺 marketFrequency 列（v3.0 新增）
  const skillCols = (d.prepare("PRAGMA table_info(skills)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!skillCols.includes("marketFrequency")) {
    d.exec("ALTER TABLE skills ADD COLUMN marketFrequency REAL NOT NULL DEFAULT 1.0");
  }

  // ============ 增量 v0.1：设计说明 7.1–7.4 + P2 前置 ============
  d.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_meta (
      id            INTEGER PRIMARY KEY,
      version       TEXT NOT NULL,
      published_at  TEXT NOT NULL,
      notes         TEXT
    );
    CREATE TABLE IF NOT EXISTS job_work_tags (
      job_id        TEXT NOT NULL,
      tag_id        TEXT NOT NULL,
      tier          TEXT NOT NULL,
      note          TEXT,
      review_status TEXT NOT NULL DEFAULT 'assumed',
      PRIMARY KEY (job_id, tag_id, tier)
    );
    CREATE INDEX IF NOT EXISTS idx_job_work_tags_tag ON job_work_tags(tag_id, tier);
    CREATE TABLE IF NOT EXISTS raw_jd_observations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id        TEXT,
      raw_text      TEXT NOT NULL,
      text_hash     TEXT,
      parsed_skills TEXT,
      source        TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_obs_job ON raw_jd_observations(job_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_hash ON raw_jd_observations(text_hash);
    CREATE TABLE IF NOT EXISTS change_suggestions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id         TEXT NOT NULL,
      skill_id       TEXT NOT NULL,
      suggestion     TEXT NOT NULL,
      current_value  TEXT,
      proposed_value TEXT,
      evidence_count INTEGER,
      status         TEXT DEFAULT 'pending',
      created_at     TEXT NOT NULL,
      resolved_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS aggregation_state (
      task              TEXT PRIMARY KEY,
      last_processed_id INTEGER NOT NULL DEFAULT 0,
      updated_at        TEXT NOT NULL
    );
  `);

  // 扩展列：逐列 try/catch，老库升级不丢数据
  ensureColumns(d, "jobs", [
    ["source_date", "source_date TEXT"],
    ["updated_at", "updated_at TEXT"],
    ["verified_at", "verified_at TEXT"],
    ["sample_size", "sample_size INTEGER"],
    ["confidence", "confidence TEXT"],
    ["work_tags", "work_tags TEXT"],
  ]);
  ensureColumns(d, "skills", [
    ["source_date", "source_date TEXT"],
    ["updated_at", "updated_at TEXT"],
    ["verified_at", "verified_at TEXT"],
    ["sample_size", "sample_size INTEGER"],
    ["confidence", "confidence TEXT"],
    ["action", "action TEXT"],
  ]);
  ensureColumns(d, "tracks", [
    ["one_liner", "one_liner TEXT"],
    ["sub_directions", "sub_directions TEXT"],
    ["glossary", "glossary TEXT"],
    ["entry_cycle", "entry_cycle TEXT"],
    ["hard_thresholds", "hard_thresholds TEXT"],
    ["data_note", "data_note TEXT"],
    ["verified_at", "verified_at TEXT"],
    ["sample_size", "sample_size INTEGER"],
    ["confidence", "confidence TEXT"],
  ]);
}

function seedIfEmpty(d: DatabaseSync) {
  const readJson = (file: string) =>
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", file), "utf-8"));
  const jobsJson = readJson("jobs.json");
  const skillsJson = readJson("skills.json");
  // 4 个新数据文件是静态配置（不入表），写入 meta 便于诊断；getKnowledgeBase 直接读文件下发
  const exclusionsJson = readJson("exclusions.json");
  const starterSkillsJson = readJson("starter-skills.json");
  const deliverableTypesJson = readJson("deliverable-types.json");
  const actionTemplatesJson = readJson("action-templates.json");

  const count = (d.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n;
  const jobsMetaRow = d.prepare("SELECT value FROM meta WHERE key = 'jobs_meta'").get() as
    | { value: string }
    | undefined;
  const storedJobsVersion = jobsMetaRow ? JSON.parse(jobsMetaRow.value).version : "";
  const skillsMetaRow = d.prepare("SELECT value FROM meta WHERE key = 'skills_meta'").get() as
    | { value: string }
    | undefined;
  const storedSkillsVersion = skillsMetaRow ? JSON.parse(skillsMetaRow.value).version : "";

  // 首次运行（count===0）或数据版本升级时，清掉知识库并重新种子化。
  // 注意：绝不触碰 user_profile / user_plans / user_jds，用户态数据要保留。
  if (
    count > 0 &&
    storedJobsVersion === (jobsJson._meta?.version ?? "") &&
    storedSkillsVersion === (skillsJson._meta?.version ?? "")
  )
    return;
  if (count > 0) {
    d.exec("DELETE FROM jobs; DELETE FROM skills; DELETE FROM tracks; DELETE FROM job_work_tags;");
  }

  const insertTrack = d.prepare(
    `INSERT OR REPLACE INTO tracks
       (id, name, one_liner, sub_directions, glossary, entry_cycle, hard_thresholds, data_note,
        verified_at, sample_size, confidence)
     VALUES (@id, @name, @one_liner, @sub_directions, @glossary, @entry_cycle, @hard_thresholds, @data_note,
        @verified_at, @sample_size, @confidence)`
  );
  for (const t of jobsJson.tracks) {
    insertTrack.run({
      id: t.id,
      name: t.name,
      one_liner: t.oneLiner ?? "",
      sub_directions: JSON.stringify(t.subDirections ?? []),
      glossary: JSON.stringify(t.glossary ?? []),
      entry_cycle: t.entryCycle ?? "",
      hard_thresholds: JSON.stringify(t.hardThresholds ?? []),
      data_note: t.dataNote ?? "",
      verified_at: t.verifiedAt ?? "",
      sample_size: t.sampleSize ?? 0,
      confidence: t.confidence ?? confidenceForSampleSize(t.sampleSize ?? 0),
    });
  }

  const insertJob = d.prepare(
    `INSERT OR REPLACE INTO jobs
       (id, title, track, summary, core, plus, threshold, salary_intern, salary_junior, certs, growth,
        source_date, updated_at, verified_at, sample_size, confidence, work_tags)
     VALUES (@id, @title, @track, @summary, @core, @plus, @threshold, @salary_intern, @salary_junior, @certs, @growth,
        @source_date, @updated_at, @verified_at, @sample_size, @confidence, @work_tags)`
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
      source_date: j.source_date ?? "",
      updated_at: j.updated_at ?? new Date().toISOString(),
      verified_at: j.verified_at ?? "",
      sample_size: j.sample_size ?? 0,
      confidence: j.confidence ?? confidenceForSampleSize(j.sample_size ?? 0),
      work_tags: JSON.stringify(j.workTags ?? []),
    });
  }

  // workTags 是唯一真源，镜像到 job_work_tags（PRD 4.8）
  const insertWorkTag = d.prepare(
    `INSERT OR REPLACE INTO job_work_tags (job_id, tag_id, tier, note, review_status)
     VALUES (@job_id, @tag_id, @tier, @note, @review_status)`
  );
  for (const j of jobsJson.jobs) {
    for (const t of j.workTags ?? []) {
      insertWorkTag.run({
        job_id: j.id,
        tag_id: t.tag,
        tier: t.tier,
        note: t.note ?? "",
        review_status: t.reviewStatus ?? "assumed",
      });
    }
  }

  const insertSkill = d.prepare(
    `INSERT OR REPLACE INTO skills
       (id, name, category, aliases, estHours, resources, marketFrequency,
        source_date, updated_at, verified_at, sample_size, confidence, action)
     VALUES (@id, @name, @category, @aliases, @estHours, @resources, @marketFrequency,
        @source_date, @updated_at, @verified_at, @sample_size, @confidence, @action)`
  );
  for (const s of skillsJson.skills) {
    insertSkill.run({
      id: s.id,
      name: s.name,
      category: s.category ?? "",
      aliases: JSON.stringify(s.aliases ?? []),
      estHours: s.estHours ?? 0,
      resources: JSON.stringify(s.resources ?? []),
      marketFrequency: s.marketFrequency ?? 1.0,
      source_date: s.source_date ?? "",
      updated_at: s.updated_at ?? new Date().toISOString(),
      verified_at: s.verified_at ?? "",
      sample_size: s.sample_size ?? 0,
      confidence: s.confidence ?? confidenceForSampleSize(s.sample_size ?? 0),
      action: s.action ? JSON.stringify(s.action) : null,
    });
  }

  const setMeta = d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
  setMeta.run("jobs_meta", JSON.stringify(jobsJson._meta ?? {}));
  setMeta.run("skills_meta", JSON.stringify(skillsJson._meta ?? {}));
  setMeta.run("exclusions_meta", JSON.stringify(exclusionsJson._meta ?? {}));
  setMeta.run("starter_skills_meta", JSON.stringify(starterSkillsJson._meta ?? {}));
  setMeta.run("deliverable_types_meta", JSON.stringify(deliverableTypesJson._meta ?? {}));
  setMeta.run("action_templates_meta", JSON.stringify(actionTemplatesJson._meta ?? {}));

  d.prepare(
    `INSERT OR REPLACE INTO knowledge_meta (id, version, published_at, notes)
     VALUES (1, ?, ?, ?)`
  ).run(
    jobsJson._meta?.version ?? "?",
    new Date().toISOString(),
    "增量 v0.1：workTags + 领域说明书 + 时效字段 + 交付物模板"
  );
}

/** Cookie 签名密钥留在本地数据库，不进入浏览器响应。 */
export function getOrCreateSessionSecret(): string {
  const d = db();
  const current = d.prepare("SELECT value FROM meta WHERE key = 'session_secret'").get() as
    | { value: string }
    | undefined;
  if (current?.value) return current.value;
  const generated = randomBytes(32).toString("hex");
  d.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('session_secret', ?)").run(generated);
  return (d.prepare("SELECT value FROM meta WHERE key = 'session_secret'").get() as { value: string }).value;
}

/** 首个新访客会话承接旧版单机数据；此后各会话只读取自己的数据。 */
export function claimLegacyData(ownerId: string): void {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const claimed = d.prepare("SELECT value FROM meta WHERE key = 'legacy_data_claimed'").get();
    if (!claimed) {
      d.prepare("UPDATE user_profile SET key = ?, owner_id = ? WHERE key = 'local' AND owner_id = 'legacy-local'").run(ownerId, ownerId);
      d.prepare("UPDATE user_plans SET owner_id = ? WHERE owner_id = 'legacy-local'").run(ownerId);
      d.prepare("UPDATE user_jds SET owner_id = ? WHERE owner_id = 'legacy-local'").run(ownerId);
      d.prepare("INSERT INTO meta (key, value) VALUES ('legacy_data_claimed', ?)").run(ownerId);
    }
    d.exec("COMMIT");
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
}

interface JobDbRow {
  id: string;
  title: string;
  track: string;
  summary: string | null;
  core: string;
  plus: string | null;
  threshold: string | null;
  salary_intern: string | null;
  salary_junior: string | null;
  certs: string | null;
  growth: string | null;
  work_tags?: string | null;
  source_date?: string | null;
  updated_at?: string | null;
  verified_at?: string | null;
  sample_size?: number | null;
  confidence?: string | null;
}

interface SkillDbRow {
  id: string;
  name: string;
  category: string | null;
  aliases: string;
  estHours: number;
  resources: string;
  marketFrequency: number;
  action: string | null;
  source_date?: string | null;
  updated_at?: string | null;
  verified_at?: string | null;
  sample_size?: number | null;
  confidence?: string | null;
}

interface TrackDbRow {
  id: string;
  name: string;
  one_liner?: string | null;
  sub_directions?: string | null;
  glossary?: string | null;
  entry_cycle?: string | null;
  hard_thresholds?: string | null;
  data_note?: string | null;
  verified_at?: string | null;
  sample_size?: number | null;
  confidence?: string | null;
}

interface ProfileDbRow {
  key: string;
  name: string;
  step: number;
  started: number;
  profile: string;
  workflow?: string | null;
  selected_job: string;
  done_skills: string;
  updated_at: string;
}

interface PlanDbRow {
  id: string;
  name: string | null;
  created_at: number;
  major: string | null;
  job_title: string | null;
  summary: string | null;
  markdown: string | null;
}

interface JdDbRow {
  id: string;
  title: string | null;
  raw: string | null;
  skills: string | null;
  created_at: number;
}

interface JobReferenceDbRow {
  id: string;
  title: string;
  core: string | null;
  plus: string | null;
}

export interface KnowledgeBase {
  jobs: Array<{
    id: string; title: string; track: string; summary: string | null;
    core: { s: string; w: number }[]; plus: string[]; threshold: string | null;
    salary: { intern: string | null; junior: string | null }; certs: string[];
    growth: string | null; workTags: WorkTag[]; source_date: string; updated_at: string;
    verified_at: string; sample_size: number; confidence: string;
  }>;
  skills: Array<{
    id: string; name: string; category: string | null; aliases: string[]; estHours: number;
    resources: Array<{ title: string; platform: string }>; marketFrequency: number;
    action?: { deliverableType?: string; deliverable?: string; acceptance?: string };
    source_date: string; updated_at: string; verified_at: string; sample_size: number; confidence: string;
  }>;
  tracks: Array<{
    id: string; name: string; oneLiner: string; subDirections: string[];
    glossary: Array<{ term: string; plain: string }>; entryCycle: string;
    hardThresholds: string[]; dataNote: string; verifiedAt: string;
    sampleSize: number; confidence: string;
  }>;
  meta: { version: string; note: string; salaryNote: string };
  /** 开场排除选项定义（内容 + 条件）；条件项仅自我清单，不参与排除 */
  exclusions: {
    contentOptions: Array<{ id: string; tag: string; label: string; reason: string }>;
    contextOptions: Array<{ id: string; tag: string; label: string; reason: string }>;
    _meta?: Record<string, unknown>;
  };
  starterSkills: { items: Array<{ id: string; label: string; skillIds: string[] }>; _meta?: Record<string, unknown> };
  deliverableTypes: {
    types: Record<string, { label: string; requiredElements: string[] }>;
    _meta?: Record<string, unknown>;
  };
  actionTemplates: {
    byCategory: Record<string, { deliverableType: string; deliverable: string; acceptance: string }>;
    _meta?: Record<string, unknown>;
  };
  knowledgeMeta: { version: string; publishedAt: string; notes?: string };
  onet: {
    version: string; releaseDate: string; source: string; dictionary: string; license: string;
    retrievedAt: string; notes: string; skillMappings: Record<string, string[]>;
  };
}

/** 一次性返回整库知识库，供前端注入 matcher / orientation 后在本地计算 */
export function getKnowledgeBase(): KnowledgeBase {
  const d = db();
  const readJson = <T,>(file: string): T =>
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", file), "utf-8"));
  const exclusions = readJson<KnowledgeBase["exclusions"]>("exclusions.json");
  const starterSkills = readJson<KnowledgeBase["starterSkills"]>("starter-skills.json");
  const deliverableTypes = readJson<KnowledgeBase["deliverableTypes"]>("deliverable-types.json");
  const actionTemplates = readJson<KnowledgeBase["actionTemplates"]>("action-templates.json");
  const onet = readJson<KnowledgeBase["onet"]>("onet-31.0.json");

  const jobs = d.prepare("SELECT * FROM jobs").all<JobDbRow>().map((r) => ({
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
    workTags: JSON.parse(r.work_tags || "[]"),
    source_date: r.source_date ?? "",
    updated_at: r.updated_at ?? "",
    verified_at: r.verified_at ?? "",
    sample_size: r.sample_size ?? 0,
    confidence: r.confidence ?? "",
  }));
  const skills = d.prepare("SELECT * FROM skills").all<SkillDbRow>().map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    aliases: JSON.parse(r.aliases),
    estHours: r.estHours,
    resources: JSON.parse(r.resources),
    marketFrequency: r.marketFrequency,
    action: r.action ? JSON.parse(r.action) : undefined,
    source_date: r.source_date ?? "",
    updated_at: r.updated_at ?? "",
    verified_at: r.verified_at ?? "",
    sample_size: r.sample_size ?? 0,
    confidence: r.confidence ?? "",
  }));
  const tracks = d.prepare("SELECT * FROM tracks").all<TrackDbRow>().map((r) => ({
    id: r.id,
    name: r.name,
    oneLiner: r.one_liner ?? "",
    subDirections: JSON.parse(r.sub_directions || "[]"),
    glossary: JSON.parse(r.glossary || "[]"),
    entryCycle: r.entry_cycle ?? "",
    hardThresholds: JSON.parse(r.hard_thresholds || "[]"),
    dataNote: r.data_note ?? "",
    verifiedAt: r.verified_at ?? "",
    sampleSize: r.sample_size ?? 0,
    confidence: r.confidence ?? "",
  }));
  const metaRow = d.prepare("SELECT value FROM meta WHERE key = 'jobs_meta'").get() as
    | { value: string }
    | undefined;
  const meta = metaRow ? JSON.parse(metaRow.value) : { version: "?", note: "", salaryNote: "" };
  const kmRow = d
    .prepare("SELECT version, published_at, notes FROM knowledge_meta WHERE id = 1")
    .get() as { version: string; published_at: string; notes: string } | undefined;
  const knowledgeMeta = kmRow
    ? { version: kmRow.version, publishedAt: kmRow.published_at, notes: kmRow.notes ?? undefined }
    : { version: meta.version ?? "?", publishedAt: "", notes: undefined };
  return { jobs, skills, tracks, meta, exclusions, starterSkills, deliverableTypes, actionTemplates, knowledgeMeta, onet };
}

/* ============================================================
   用户态（运行时写入，让数据库真正"用起来"）
   无账号访客场景：各浏览器会话通过 owner_id 隔离
   ============================================================ */
export interface ProfileRow {
  id: string;
  name: string;
  step: number;
  started: boolean;
  profile: Profile;
  workflow: WorkflowState | null;
  selectedJobId: string;
  doneSkills: string[];
  updatedAt: string;
}

export function listProfiles(ownerId: string): ProfileRow[] {
  const d = db();
  return (
    d
      .prepare(
        "SELECT key, name, step, started, profile, workflow, selected_job, done_skills, updated_at FROM user_profile WHERE owner_id = ? ORDER BY updated_at DESC"
      )
      .all<ProfileDbRow>(ownerId)
  ).map((r) => ({
    id: r.key,
    name: r.name,
    step: r.step,
    started: !!r.started,
    profile: JSON.parse(r.profile),
    workflow: JSON.parse(r.workflow || "null"),
    selectedJobId: r.selected_job,
    doneSkills: JSON.parse(r.done_skills || "[]"),
    updatedAt: r.updated_at,
  }));
}

export function getUserProfile(ownerId: string): ProfileRow | null {
  const d = db();
  const row = d.prepare("SELECT * FROM user_profile WHERE owner_id = ? LIMIT 1").get<ProfileDbRow>(ownerId);
  if (!row) return null;
  return {
    id: row.key,
    name: row.name,
    step: row.step,
    started: !!row.started,
    profile: JSON.parse(row.profile),
    workflow: JSON.parse(row.workflow || "null"),
    selectedJobId: row.selected_job,
    doneSkills: JSON.parse(row.done_skills || "[]"),
    updatedAt: row.updated_at,
  };
}

export function saveUserProfile(p: ProfileRow, ownerId: string) {
  const d = db();
  // GitHub 自动审计是服务端锁定证据：即使旧的浏览器自动保存请求晚到，
  // 也不能删除审计记录或把已提档等级降回去。
  const currentRow = d.prepare("SELECT profile FROM user_profile WHERE owner_id = ? LIMIT 1").get<{ profile: string }>(ownerId);
  let profile = p.profile ?? ({} as Profile);
  if (currentRow?.profile) {
    try {
      const current = JSON.parse(currentRow.profile) as Profile;
      const locked = Object.entries(current.actionEvaluations ?? {}).filter(([, value]) => value?.source === "github-api");
      if (locked.length) {
        const evaluations = { ...(profile.actionEvaluations ?? {}) };
        const evidenceLevels = { ...(profile.evidenceLevels ?? {}) };
        for (const [actionId, evaluation] of locked) {
          const incoming = evaluations[actionId];
          if (!incoming || incoming.source !== "github-api" || (incoming.githubAudit?.auditedAt ?? 0) < (evaluation.githubAudit?.auditedAt ?? 0)) {
            evaluations[actionId] = evaluation;
          }
          if (evaluation.skillId) {
            evidenceLevels[evaluation.skillId] = Math.max(evidenceLevels[evaluation.skillId] ?? 1, evaluation.finalLevel);
          }
        }
        profile = { ...profile, actionEvaluations: evaluations, evidenceLevels };
      }
    } catch {
      // 损坏的旧画像仍按原保存路径处理；不会阻塞普通草稿保存。
    }
  }
  d.prepare(
    `INSERT OR REPLACE INTO user_profile
       (key, owner_id, name, step, started, profile, workflow, selected_job, done_skills, updated_at)
     VALUES (@key, @owner_id, @name, @step, @started, @profile, @workflow, @selected_job, @done_skills, @updated_at)`
  ).run({
    key: ownerId,
    owner_id: ownerId,
    name: p.name ?? "",
    step: p.step,
    started: p.started ? 1 : 0,
    profile: JSON.stringify(profile),
    workflow: JSON.stringify(p.workflow ?? null),
    selected_job: p.selectedJobId ?? "",
    done_skills: JSON.stringify(p.doneSkills ?? []),
    updated_at: new Date().toISOString(),
  });
}

export function deleteUserProfile(ownerId: string) {
  const d = db();
  d.prepare("DELETE FROM user_profile WHERE owner_id = ?").run(ownerId);
}

/** Remove every persisted record owned by this guest as one atomic operation. */
export function clearGuestData(ownerId: string): void {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    d.prepare("DELETE FROM user_profile WHERE owner_id = ?").run(ownerId);
    d.prepare("DELETE FROM user_plans WHERE owner_id = ?").run(ownerId);
    d.prepare("DELETE FROM user_jds WHERE owner_id = ?").run(ownerId);
    d.exec("COMMIT");
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
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

export function listPlans(ownerId: string): PlanRow[] {
  const d = db();
  return (
    d
      .prepare(
        "SELECT id, name, created_at, major, job_title, summary, markdown FROM user_plans WHERE owner_id = ? ORDER BY created_at DESC"
      )
      .all<PlanDbRow>(ownerId)
  ).map((r) => ({
    id: r.id,
    name: r.name ?? "",
    createdAt: r.created_at,
    major: r.major ?? "",
    jobTitle: r.job_title ?? "",
    summary: r.summary ?? "",
    markdown: r.markdown ?? "",
  }));
}

export function addPlanRec(rec: PlanRow, ownerId: string): boolean {
  const d = db();
  const result = d.prepare(
    `INSERT INTO user_plans
       (id, owner_id, name, created_at, major, job_title, summary, markdown)
     VALUES (@id, @owner_id, @name, @created_at, @major, @job_title, @summary, @markdown)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, created_at = excluded.created_at, major = excluded.major,
       job_title = excluded.job_title, summary = excluded.summary, markdown = excluded.markdown
     WHERE user_plans.owner_id = excluded.owner_id`
  ).run({
    id: rec.id,
    owner_id: ownerId,
    name: rec.name ?? "",
    created_at: rec.createdAt,
    major: rec.major ?? "",
    job_title: rec.jobTitle ?? "",
    summary: rec.summary ?? "",
    markdown: rec.markdown ?? "",
  }) as { changes: number | bigint };
  return Number(result.changes) > 0;
}

export function deletePlanRec(id: string, ownerId: string): boolean {
  const d = db();
  const result = d.prepare("DELETE FROM user_plans WHERE id = ? AND owner_id = ?").run(id, ownerId) as { changes: number | bigint };
  return Number(result.changes) > 0;
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
  const r = db().prepare("SELECT * FROM jobs WHERE id = ?").get<JobDbRow>(id);
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
    workTags: JSON.parse(r.work_tags || "[]"),
    source_date: r.source_date ?? "",
    updated_at: r.updated_at ?? "",
    verified_at: r.verified_at ?? "",
    sample_size: r.sample_size ?? 0,
    confidence: r.confidence ?? "",
  };
}

export function upsertJob(job: JobInput) {
  const d = db();
  // 保留新增列：管理员编辑岗位不应清空 workTags / 时效字段
  const existing = d
    .prepare("SELECT source_date, verified_at, sample_size, confidence, work_tags FROM jobs WHERE id = ?")
    .get<Pick<JobDbRow, "source_date" | "verified_at" | "sample_size" | "confidence" | "work_tags">>(job.id);
  d.prepare(
    `INSERT OR REPLACE INTO jobs
       (id, title, track, summary, core, plus, threshold, salary_intern, salary_junior, certs, growth,
        source_date, updated_at, verified_at, sample_size, confidence, work_tags)
     VALUES (@id, @title, @track, @summary, @core, @plus, @threshold, @salary_intern, @salary_junior, @certs, @growth,
        @source_date, @updated_at, @verified_at, @sample_size, @confidence, @work_tags)`
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
    source_date: existing?.source_date ?? "",
    updated_at: new Date().toISOString(),
    verified_at: existing?.verified_at ?? "",
    sample_size: existing?.sample_size ?? 0,
    confidence: existing?.confidence ?? "",
    work_tags: existing?.work_tags ?? "[]",
  });
}

export function deleteJob(id: string) {
  db().prepare("DELETE FROM jobs WHERE id = ?").run(id);
}

export function getSkillById(id: string) {
  const r = db().prepare("SELECT * FROM skills WHERE id = ?").get<SkillDbRow>(id);
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    aliases: JSON.parse(r.aliases),
    estHours: r.estHours,
    resources: JSON.parse(r.resources),
    marketFrequency: r.marketFrequency,
    action: r.action ? JSON.parse(r.action) : undefined,
    source_date: r.source_date ?? "",
    updated_at: r.updated_at ?? "",
    verified_at: r.verified_at ?? "",
    sample_size: r.sample_size ?? 0,
    confidence: r.confidence ?? "",
  };
}

export function upsertSkill(skill: SkillInput) {
  const d = db();
  // 保留新增列：管理员编辑技能不应清空 action / 时效字段 / marketFrequency
  const existing = d
    .prepare(
      "SELECT marketFrequency, source_date, verified_at, sample_size, confidence, action FROM skills WHERE id = ?"
    )
    .get<Pick<SkillDbRow, "marketFrequency" | "source_date" | "verified_at" | "sample_size" | "confidence" | "action">>(skill.id);
  d.prepare(
    `INSERT OR REPLACE INTO skills
       (id, name, category, aliases, estHours, resources, marketFrequency,
        source_date, updated_at, verified_at, sample_size, confidence, action)
     VALUES (@id, @name, @category, @aliases, @estHours, @resources, @marketFrequency,
        @source_date, @updated_at, @verified_at, @sample_size, @confidence, @action)`
  ).run({
    id: skill.id,
    name: skill.name,
    category: skill.category ?? "",
    aliases: JSON.stringify(skill.aliases ?? []),
    estHours: skill.estHours ?? 0,
    resources: JSON.stringify(skill.resources ?? []),
    marketFrequency: existing?.marketFrequency ?? 1.0,
    source_date: existing?.source_date ?? "",
    updated_at: new Date().toISOString(),
    verified_at: existing?.verified_at ?? "",
    sample_size: existing?.sample_size ?? 0,
    confidence: existing?.confidence ?? "",
    action: existing?.action ?? null,
  });
}

export function listJobsReferencingSkill(id: string): { id: string; title: string; role: "core" | "plus" }[] {
  const rows = db().prepare("SELECT id, title, core, plus FROM jobs").all<JobReferenceDbRow>();
  const refs: { id: string; title: string; role: "core" | "plus" }[] = [];
  for (const row of rows) {
    const core = JSON.parse(row.core || "[]") as { s: string; w: number }[];
    const plus = JSON.parse(row.plus || "[]") as string[];
    if (core.some((item) => item.s === id)) refs.push({ id: row.id, title: row.title, role: "core" });
    if (plus.includes(id)) refs.push({ id: row.id, title: row.title, role: "plus" });
  }
  return refs;
}

export function deleteSkill(id: string): { deleted: boolean; references: { id: string; title: string; role: "core" | "plus" }[] } {
  const references = listJobsReferencingSkill(id);
  if (references.length) return { deleted: false, references };
  const result = db().prepare("DELETE FROM skills WHERE id = ?").run(id) as { changes: number | bigint };
  return { deleted: Number(result.changes) > 0, references: [] };
}

/* ============================================================
   用户 JD 库（真实岗位收藏：标题 + JD 全文 + 抽取的技能 id）
   从你的目标 JD 出发做匹配，作为内置 579 岗之外的「个人真实目标」来源。
   ============================================================ */
export interface JdRow {
  id: string;
  title: string;
  raw: string;
  /** 从 JD 文本抽取的库内技能 id 列表（出现即视为「重要(2)」，JD 无权重信息） */
  skills: string[];
  createdAt: number;
}

export function listJds(ownerId: string): JdRow[] {
  const d = db();
  return (
    d
      .prepare("SELECT id, title, raw, skills, created_at FROM user_jds WHERE owner_id = ? ORDER BY created_at DESC")
      .all<JdDbRow>(ownerId)
  ).map((r) => ({
    id: r.id,
    title: r.title ?? "",
    raw: r.raw ?? "",
    skills: JSON.parse(r.skills || "[]"),
    createdAt: r.created_at,
  }));
}

export function addJd(jd: JdRow, ownerId: string): boolean {
  const d = db();
  const result = d.prepare(
    `INSERT INTO user_jds
       (id, owner_id, title, raw, skills, created_at)
     VALUES (@id, @owner_id, @title, @raw, @skills, @created_at)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, raw = excluded.raw,
       skills = excluded.skills, created_at = excluded.created_at
     WHERE user_jds.owner_id = excluded.owner_id`
  ).run({
    id: jd.id,
    owner_id: ownerId,
    title: jd.title ?? "",
    raw: jd.raw ?? "",
    skills: JSON.stringify(jd.skills ?? []),
    created_at: jd.createdAt,
  }) as { changes: number | bigint };
  return Number(result.changes) > 0;
}

export function deleteJd(id: string, ownerId: string): boolean {
  const result = db().prepare("DELETE FROM user_jds WHERE id = ? AND owner_id = ?").run(id, ownerId) as { changes: number | bigint };
  return Number(result.changes) > 0;
}

/* ============================================================
   用户 JD 观察（P1-1，只增不改）
   防卡死三约束：请求路径只有一次 INSERT、无聚合查询、失败不影响解析返回。
   ============================================================ */
export interface RawJdObservationInput {
  jobId?: string | null;
  rawText: string;
  parsedSkills: string[];
  source?: "user_paste" | "manual";
  createdAt?: number;
}

/** 记录开关：环境变量优先，其次 meta 表；默认开启（UI 开关在第 3 轮） */
export function isJdObservationRecordingEnabled(): boolean {
  const env = process.env.JD_OBSERVATION_RECORDING;
  if (env === "0" || env === "false") return false;
  if (env === "1" || env === "true") return true;
  const row = db().prepare("SELECT value FROM meta WHERE key = 'jd_observation_recording'").get() as
    | { value: string }
    | undefined;
  if (row) return row.value !== "0" && row.value !== "false";
  return true;
}

/**
 * 写入一条 JD 观察：text_hash 去重（唯一索引 + INSERT OR IGNORE），
 * 请求路径上**只有这一条 INSERT**，绝不出现聚合查询。
 * @returns 是否真正写入（重复文本返回 false）
 */
export function insertRawJdObservation(input: RawJdObservationInput): boolean {
  const rawText = typeof input?.rawText === "string" ? input.rawText : "";
  if (!rawText) return false;
  const textHash = createHash("sha256").update(rawText).digest("hex");
  const createdAt = input.createdAt ? new Date(input.createdAt).toISOString() : new Date().toISOString();
  const result = db()
    .prepare(
      `INSERT OR IGNORE INTO raw_jd_observations
         (job_id, raw_text, text_hash, parsed_skills, source, created_at)
       VALUES (@job_id, @raw_text, @text_hash, @parsed_skills, @source, @created_at)`
    )
    .run({
      job_id: input.jobId ?? null,
      raw_text: rawText,
      text_hash: textHash,
      parsed_skills: JSON.stringify(Array.isArray(input.parsedSkills) ? input.parsedSkills : []),
      source: input.source ?? "user_paste",
      created_at: createdAt,
    }) as { changes: number | bigint };
  return Number(result.changes) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验岗位提交：id 合法、方向存在、core/plus 引用的技能存在、权重∈{1,2,3} */
export function validateJobInput(body: unknown): { ok: true; job: JobInput } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "请求体必须是对象" };
  const id = String(body.id ?? "").trim();
  const title = String(body.title ?? "").trim();
  const track = String(body.track ?? "").trim();
  if (!id) return { ok: false, error: "岗位 id 不能为空" };
  if (!/^[a-z0-9][a-z0-9\-]*$/.test(id)) return { ok: false, error: "id 只能以小写字母/数字开头，仅含小写字母/数字/连字符" };
  if (!title) return { ok: false, error: "岗位标题不能为空" };
  const trackIds = new Set(allTrackIds());
  if (!trackIds.has(track)) return { ok: false, error: `方向不存在: ${track}` };
  const skillIds = new Set(allSkillIds());
  const core: NonNullable<JobInput["core"]> = [];
  for (const value of Array.isArray(body.core) ? body.core : []) {
    const item = isRecord(value) ? value : {};
    const s = String(item.s ?? "").trim();
    const w = Number(item.w);
    if (!s) return { ok: false, error: "核心技能存在空 id" };
    if (!skillIds.has(s)) return { ok: false, error: `核心技能不存在: ${s}` };
    if (![1, 2, 3].includes(w)) return { ok: false, error: `核心技能权重必须为 1/2/3，收到: ${w}` };
    core.push({ s, w });
  }
  const plus = Array.isArray(body.plus) ? body.plus.map(String) : [];
  for (const p of plus) if (!skillIds.has(p)) return { ok: false, error: `加分技能不存在: ${p}` };
  const salary = isRecord(body.salary) ? body.salary : {};
  const job: JobInput = {
    id,
    title,
    track,
    summary: String(body.summary ?? ""),
    core,
    plus,
    threshold: String(body.threshold ?? ""),
    salary: { intern: String(salary.intern ?? ""), junior: String(salary.junior ?? "") },
    certs: Array.isArray(body.certs) ? body.certs.map(String) : [],
    growth: String(body.growth ?? ""),
  };
  return { ok: true, job };
}

/** 校验技能提交：id/name 非空、estHours 为非负数字、aliases/resources 为数组 */
export function validateSkillInput(body: unknown): { ok: true; skill: SkillInput } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "请求体必须是对象" };
  const id = String(body.id ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!id) return { ok: false, error: "技能 id 不能为空" };
  if (!/^[a-z0-9][a-z0-9\-]*$/.test(id)) return { ok: false, error: "id 只能以小写字母/数字开头，仅含小写字母/数字/连字符" };
  if (!name) return { ok: false, error: "技能名称不能为空" };
  const rawEstHours = body.estHours;
  if (rawEstHours === undefined || rawEstHours === null || String(rawEstHours).trim() === "") {
    return { ok: false, error: "estHours 不能为空，必须填写大于 0 的数字" };
  }
  const estHours = Number(rawEstHours);
  if (!Number.isFinite(estHours) || estHours <= 0) return { ok: false, error: "estHours 必须为大于 0 的数字" };
  const aliases = Array.isArray(body.aliases) ? body.aliases.map(String) : [];
  const resources = Array.isArray(body.resources)
    ? body.resources.map((value) => {
        const resource = isRecord(value) ? value : {};
        return { title: String(resource.title ?? ""), platform: String(resource.platform ?? "") };
      })
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
