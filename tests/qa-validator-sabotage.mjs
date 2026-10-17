#!/usr/bin/env node
/**
 * QA 对抗性测试：校验器是不是空壳（B 组）
 *
 * 做法：在隔离镜像 `.qa-mirror/`（由本脚本自建）上逐条注入缺陷，
 * 运行 `validate-data.mjs`，检查它是否真的报警；每次注入后立即还原。
 * **绝不触碰项目真实 data/**。
 *
 * 运行：node tests/qa-validator-sabotage.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIRROR = path.join(ROOT, ".qa-mirror");

// ---- 建镜像（真实数据的副本，只读源）----
// 注意：本环境 fs.rmSync 被 safe-delete shim 接管且会超时，故只用「覆盖写」还原，
// 不删除目录；镜像始终与真实数据文件同名，逐次覆盖即可复位。
function buildMirror() {
  fs.mkdirSync(path.join(MIRROR, "scripts", "data"), { recursive: true });
  fs.mkdirSync(path.join(MIRROR, "data"), { recursive: true });
  fs.mkdirSync(path.join(MIRROR, "lib"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts", "data", "validate-data.mjs"), path.join(MIRROR, "scripts", "data", "validate-data.mjs"));
  for (const f of fs.readdirSync(path.join(ROOT, "data"))) fs.copyFileSync(path.join(ROOT, "data", f), path.join(MIRROR, "data", f));
  for (const f of ["links.ts", "confidence.mjs", "action-template.mjs"]) fs.copyFileSync(path.join(ROOT, "lib", f), path.join(MIRROR, "lib", f));
}

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(MIRROR, "data", name), "utf8"));
const writeJson = (name, obj) => fs.writeFileSync(path.join(MIRROR, "data", name), JSON.stringify(obj, null, 2));

function runValidator() {
  try {
    const out = execFileSync(process.execPath, [path.join(MIRROR, "scripts", "data", "validate-data.mjs")], { encoding: "utf8" });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

const results = [];
function test(id, desc, mutate) {
  buildMirror();
  // 基线必须 PASS，否则测试无意义
  const base = runValidator();
  if (!base.ok) {
    results.push({ id, desc, verdict: "SKIP", detail: "镜像基线未通过，无法判定" });
    return;
  }
  try {
    mutate();
  } catch (e) {
    results.push({ id, desc, verdict: "ERROR", detail: `注入失败: ${e.message}` });
    return;
  }
  const r = runValidator();
  const failedLines = r.out.split("\n").filter((l) => l.startsWith("✗")).map((l) => l.trim());
  results.push({
    id,
    desc,
    verdict: r.ok ? "NO-ALARM" : "ALARMED",
    detail: r.ok ? "校验器仍然 PASS —— 该检查疑似空壳！" : failedLines.slice(0, 3).join(" | "),
  });
}

// ---------------- 5 个必测注入 ----------------

// B1 条件 tag 回流
test("B1", "给某岗 workTags 加一条条件 tag（防回流）", () => {
  const j = readJson("jobs.json");
  j.jobs[0].workTags.push({ tag: "frequent-travel", tier: "core", note: "依据 summary「x」", reviewStatus: "assumed" });
  writeJson("jobs.json", j);
});

// B2 note 引用不存在的 summary 片段
test("B2", "把某 note 引用的 summary 片段改成不存在的文字", () => {
  const j = readJson("jobs.json");
  const t = j.jobs[0].workTags[0];
  t.note = t.note.replace(/summary「[^」]*」/, "summary「这段文字在原文里根本不存在」");
  writeJson("jobs.json", j);
});

// B3 某内容 tag 的 core 岗位数 < 3
test("B3", "把某内容 tag 的 core 岗位删到 < 3（下限）", () => {
  const j = readJson("jobs.json");
  // 找 core 数最少的内容 tag
  const cnt = {};
  for (const job of j.jobs) for (const t of job.workTags || []) if (t.tier === "core") cnt[t.tag] = (cnt[t.tag] || 0) + 1;
  const target = Object.entries(cnt).sort((a, b) => a[1] - b[1])[0][0];
  let removed = 0;
  for (const job of j.jobs) {
    if (removed >= cnt[target] - 1) break; // 只留 1 条 → 低于下限 3
    const before = job.workTags.length;
    job.workTags = job.workTags.filter((t) => !(t.tag === target && t.tier === "core"));
    if (job.workTags.length < before) {
      // 保证每岗仍 ≥1 core，避免同时触发「每岗 ≥1 core」而掩盖下限检查
      if (!job.workTags.some((t) => t.tier === "core")) job.workTags.push({ tag: "code-debug", tier: "core", note: "依据 summary「x」", reviewStatus: "assumed" });
      removed += 1;
    }
  }
  writeJson("jobs.json", j);
});

// B4 code-debug 覆盖 > 60%
test("B4", "把 code-debug 扩到 > 60% 岗位（上限）", () => {
  const j = readJson("jobs.json");
  const need = Math.ceil(j.jobs.length * 0.6) + 2;
  let have = j.jobs.filter((x) => (x.workTags || []).some((t) => t.tag === "code-debug" && t.tier === "core")).length;
  for (const job of j.jobs) {
    if (have >= need) break;
    if ((job.workTags || []).some((t) => t.tag === "code-debug" && t.tier === "core")) continue;
    job.workTags.push({ tag: "code-debug", tier: "core", note: `依据 summary「${job.summary}」`, reviewStatus: "confirmed" });
    have += 1;
  }
  writeJson("jobs.json", j);
});

// B5 confidence 与 sample_size 矛盾
test("B5", "把某 confidence 改成与 sample_size 矛盾的值", () => {
  const j = readJson("jobs.json");
  j.jobs[0].confidence = j.jobs[0].confidence === "low" ? "high" : "low";
  writeJson("jobs.json", j);
});

// ---------------- 附加：其它声称的校验 ----------------

test("B6", "tracks.glossary 的 plain 直接复述 term", () => {
  const j = readJson("jobs.json");
  j.tracks[0].glossary[0].plain = `也就是${j.tracks[0].glossary[0].term}`;
  writeJson("jobs.json", j);
});

test("B7", "tracks.entryCycle 去掉「不是承诺」口径句", () => {
  const j = readJson("jobs.json");
  j.tracks[0].entryCycle = "3-6 个月即可入门";
  writeJson("jobs.json", j);
});

test("B8", "某技能 action 只给 deliverable 不给 acceptance（半成品覆盖）", () => {
  const s = readJson("skills.json");
  const sk = s.skills.find((x) => x.action) || s.skills[0];
  sk.action = { deliverableType: "report", deliverable: "一份报告" };
  writeJson("skills.json", s);
});

test("B9", "action-templates 的 byCategory 键与 skills.category 不一致（改错一个键）", () => {
  const a = readJson("action-templates.json");
  a.byCategory["前端X"] = a.byCategory["前端"];
  delete a.byCategory["前端"];
  writeJson("action-templates.json", a);
});

test("B10", "starterSkills 引用库外 skillId", () => {
  const st = readJson("starter-skills.json");
  st.items[0].skillIds.push("nonexistent-skill-xyz");
  writeJson("starter-skills.json", st);
});

test("B11", "_meta.version 只升 jobs 不升 skills", () => {
  const j = readJson("jobs.json");
  j._meta.version = "3.3";
  writeJson("jobs.json", j);
});

test("B12", "某岗 workTags 全部清空", () => {
  const j = readJson("jobs.json");
  j.jobs[0].workTags = [];
  writeJson("jobs.json", j);
});

// ---------------- 输出 ----------------
buildMirror(); // 收尾还原镜像
console.log("--- QA 校验器空壳检测（B 组）---");
for (const r of results) console.log(`${r.verdict === "ALARMED" ? "✓ 报警" : r.verdict === "NO-ALARM" ? "✗ 未报警(空壳?)" : "· " + r.verdict}  ${r.id}  ${r.desc}\n        ${r.detail}`);
const hollow = results.filter((r) => r.verdict === "NO-ALARM");
console.log(`\n合计 ${results.length} 项注入；报警 ${results.filter((r) => r.verdict === "ALARMED").length}；未报警 ${hollow.length}`);
if (hollow.length) console.log("疑似空壳: " + hollow.map((r) => r.id).join(", "));
process.exit(hollow.length ? 1 : 0);
