import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

/**
 * QA 对抗性测试（D-11）：老库迁移独立复现
 *
 * 自己造一个「只有旧表 + 老数据 + _meta.version = 3.1」的 career.db，
 * 在隔离临时目录里触发 migrate() + seedIfEmpty()，逐字段核对用户态数据不丢。
 * 绝不触碰项目根目录的 career.db。
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 旧库用户态样本（逐字段比对用）
const OLD_PROFILE = {
  key: "local",
  step: 3,
  started: 1,
  profile: JSON.stringify({ major: "统计学", knownSkillIds: ["sql", "python"], hoursPerWeek: 12, orientation: { skipped: true } }),
  selected_job: "data-analyst",
  done_skills: JSON.stringify(["sql"]),
  updated_at: "2026-08-01T10:00:00.000Z",
};
const OLD_PLAN = { id: "plan-legacy-1", created_at: 1750000000000, major: "统计学", job_title: "数据分析师（业务方向）", summary: "老计划", markdown: "# 老计划\n- 学 SQL" };
const OLD_JD = { id: "jd-legacy-1", title: "某公司数据分析实习", raw: "要求会 SQL 与 Excel", skills: JSON.stringify(["sql", "excel"]), created_at: 1750000001000 };

function buildOldDb(dbPath) {
  const d = new DatabaseSync(dbPath);
  d.exec(`
    CREATE TABLE tracks (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, track TEXT NOT NULL, summary TEXT,
      core TEXT NOT NULL, plus TEXT, threshold TEXT, salary_intern TEXT, salary_junior TEXT,
      certs TEXT, growth TEXT
    );
    CREATE TABLE skills (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT,
      aliases TEXT NOT NULL, estHours INTEGER NOT NULL, resources TEXT NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE user_profile (
      key TEXT PRIMARY KEY, step INTEGER NOT NULL, started INTEGER NOT NULL, profile TEXT NOT NULL,
      selected_job TEXT NOT NULL, done_skills TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE user_plans (
      id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, major TEXT, job_title TEXT, summary TEXT, markdown TEXT
    );
    CREATE TABLE user_jds (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', raw TEXT NOT NULL DEFAULT '',
      skills TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
    );
  `);
  d.prepare("INSERT INTO tracks (id,name) VALUES (?,?)").run("legacy-track", "旧方向");
  d.prepare("INSERT INTO jobs (id,title,track,summary,core,plus,threshold,salary_intern,salary_junior,certs,growth) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("legacy-old-job", "旧岗位", "legacy-track", "旧摘要", "[]", "[]", "", "", "", "[]", "");
  d.prepare("INSERT INTO skills (id,name,category,aliases,estHours,resources) VALUES (?,?,?,?,?,?)")
    .run("legacy-old-skill", "旧技能", "基础", "[]", 10, "[]");
  d.prepare("INSERT INTO meta (key,value) VALUES ('jobs_meta',?)").run(JSON.stringify({ version: "3.1" }));
  d.prepare("INSERT INTO meta (key,value) VALUES ('skills_meta',?)").run(JSON.stringify({ version: "3.1" }));
  d.prepare("INSERT INTO user_profile (key,step,started,profile,selected_job,done_skills,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(OLD_PROFILE.key, OLD_PROFILE.step, OLD_PROFILE.started, OLD_PROFILE.profile, OLD_PROFILE.selected_job, OLD_PROFILE.done_skills, OLD_PROFILE.updated_at);
  d.prepare("INSERT INTO user_plans (id,created_at,major,job_title,summary,markdown) VALUES (?,?,?,?,?,?)")
    .run(OLD_PLAN.id, OLD_PLAN.created_at, OLD_PLAN.major, OLD_PLAN.job_title, OLD_PLAN.summary, OLD_PLAN.markdown);
  d.prepare("INSERT INTO user_jds (id,title,raw,skills,created_at) VALUES (?,?,?,?,?)")
    .run(OLD_JD.id, OLD_JD.title, OLD_JD.raw, OLD_JD.skills, OLD_JD.created_at);
  d.close();
}

test("D11 老库（v3.1）迁移：用户态零丢失 + 新表/新列/镜像齐备", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-mig-"));
  const cwdBefore = process.cwd();
  const created = [];
  try {
    // 复制数据文件（seedIfEmpty / getKnowledgeBase 从 process.cwd()/data 读取）
    fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, "data"))) {
      fs.copyFileSync(path.join(ROOT, "data", f), path.join(tmp, "data", f));
      created.push(path.join(tmp, "data", f));
    }
    const dbPath = path.join(tmp, "career.db");
    buildOldDb(dbPath);

    // 关键：先 chdir 再首次 import db.ts，使 DB_PATH = tmp/career.db
    process.chdir(tmp);
    const dbMod = await import(pathToFileURL(path.join(ROOT, "lib", "db.ts")).href);
    const kb = dbMod.getKnowledgeBase(); // 触发 db() → migrate() + seedIfEmpty()

    // 用独立连接校验落盘结果
    const d = new DatabaseSync(dbPath);
    const tableNames = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    const indexNames = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name));

    // 1) 用户态逐字段比对（新列按默认值补齐，老列必须原样）
    const p = d.prepare("SELECT * FROM user_profile WHERE key='local'").get();
    assert.equal(p.step, OLD_PROFILE.step, "user_profile.step 丢失");
    assert.equal(p.started, OLD_PROFILE.started, "user_profile.started 丢失");
    assert.equal(p.profile, OLD_PROFILE.profile, "user_profile.profile 丢失");
    assert.equal(p.selected_job, OLD_PROFILE.selected_job, "user_profile.selected_job 丢失");
    assert.equal(p.done_skills, OLD_PROFILE.done_skills, "user_profile.done_skills 丢失");
    assert.equal(p.updated_at, OLD_PROFILE.updated_at, "user_profile.updated_at 丢失");
    assert.equal(p.name, "", "新增 name 列应有默认值");
    assert.equal(p.owner_id, "legacy-local", "新增 owner_id 列应有默认值");

    const pl = d.prepare("SELECT * FROM user_plans WHERE id=?").get(OLD_PLAN.id);
    for (const [k, v] of Object.entries(OLD_PLAN)) assert.equal(pl[k], v, `user_plans.${k} 丢失`);
    assert.equal(pl.name, "", "user_plans.name 默认值缺失");
    assert.equal(pl.owner_id, "legacy-local", "user_plans.owner_id 默认值缺失");

    const jd = d.prepare("SELECT * FROM user_jds WHERE id=?").get(OLD_JD.id);
    for (const [k, v] of Object.entries(OLD_JD)) assert.equal(jd[k], v, `user_jds.${k} 丢失`);
    assert.equal(jd.owner_id, "legacy-local", "user_jds.owner_id 默认值缺失");

    // 2) jobs / skills / tracks 新列齐全
    const colOf = (t) => new Set(d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
    const jobCols = colOf("jobs");
    for (const c of ["source_date", "updated_at", "verified_at", "sample_size", "confidence", "work_tags"]) assert.ok(jobCols.has(c), `jobs 缺列 ${c}`);
    const skillCols = colOf("skills");
    for (const c of ["source_date", "updated_at", "verified_at", "sample_size", "confidence", "action", "marketFrequency"]) assert.ok(skillCols.has(c), `skills 缺列 ${c}`);
    const trackCols = colOf("tracks");
    for (const c of ["one_liner", "sub_directions", "glossary", "entry_cycle", "hard_thresholds", "data_note", "verified_at", "sample_size", "confidence"]) assert.ok(trackCols.has(c), `tracks 缺列 ${c}`);

    // 3) 5 张新表 + 索引
    for (const t of ["knowledge_meta", "job_work_tags", "raw_jd_observations", "change_suggestions", "aggregation_state"]) assert.ok(tableNames.has(t), `缺新表 ${t}`);
    for (const i of ["idx_job_work_tags_tag", "idx_obs_job", "idx_obs_hash"]) assert.ok(indexNames.has(i), `缺索引 ${i}`);

    // 4) job_work_tags 行数 == jobs.json 的 workTags 总条数
    const expectedTags = kb.jobs.reduce((n, j) => n + (j.workTags || []).length, 0);
    const actualTags = d.prepare("SELECT COUNT(*) AS n FROM job_work_tags").get().n;
    assert.equal(actualTags, expectedTags, "job_work_tags 镜像行数不一致");

    // 5) 旧知识库行已被清理（版本变化触发重种子化）
    assert.equal(d.prepare("SELECT COUNT(*) AS n FROM jobs WHERE id='legacy-old-job'").get().n, 0, "legacy 岗位未清理");
    assert.equal(d.prepare("SELECT COUNT(*) AS n FROM skills WHERE id='legacy-old-skill'").get().n, 0, "legacy 技能未清理");
    assert.equal(d.prepare("SELECT COUNT(*) AS n FROM tracks WHERE id='legacy-track'").get().n, 0, "legacy 方向未清理");

    // 6) 知识库版本随 data/*.json._meta.version 升档（R1-1 起为 3.4）
    assert.equal(d.prepare("SELECT version FROM knowledge_meta WHERE id=1").get().version, "3.4");
    assert.equal(kb.knowledgeMeta.version, "3.4");
    assert.equal(kb.jobs.length, 133);
    assert.equal(kb.skills.length, 109);
    assert.equal(kb.tracks.length, 13);

    d.close();
  } finally {
    process.chdir(cwdBefore);
    // 手工清理（本环境 rmSync 被 shim 接管）
    try {
      for (const f of created) fs.unlinkSync(f);
      for (const f of ["career.db", "career.db-wal", "career.db-shm"]) {
        const p = path.join(tmp, f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      fs.rmdirSync(path.join(tmp, "data"));
      fs.rmdirSync(tmp);
    } catch {
      /* 清理失败不影响断言结果 */
    }
  }
});
