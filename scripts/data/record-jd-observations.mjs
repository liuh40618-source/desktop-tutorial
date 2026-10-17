#!/usr/bin/env node
/**
 * record-jd-observations.mjs —— 把 R1-1 的真实 JD 抽样观察写入 `raw_jd_observations`（只增不改）
 *
 * 用法（项目根目录）：
 *   node --experimental-sqlite --experimental-strip-types scripts/data/record-jd-observations.mjs
 *
 * 要点：
 *  - 复用应用**唯一写路径** `lib/db.ts#insertRawJdObservation`（text_hash 去重、单条 INSERT），
 *    不在脚本里另写一份实现，避免「脚本说写了、应用却读不到」。
 *  - 调用 `getKnowledgeBase()` 顺带触发 `migrate() + seedIfEmpty()`：数据版本升档时会重种子化
 *    知识库（jobs/skills/tracks/job_work_tags），**绝不触碰** user_profile / user_plans / user_jds。
 *  - 幂等：同一 raw_text（含来源前缀）重复运行只会写一次（INSERT OR IGNORE）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const obsPath = path.join(ROOT, "scripts", "data", "jd-observations.json");
const obs = JSON.parse(fs.readFileSync(obsPath, "utf8"));

const dbMod = await import(pathToFileURL(path.join(ROOT, "lib", "db.ts")).href);
const kb = dbMod.getKnowledgeBase();
console.log(
  `知识库版本：${kb.knowledgeMeta.version} · 岗位 ${kb.jobs.length} · 技能 ${kb.skills.length} · 方向 ${kb.tracks.length}`
);

const collectedAt = obs._meta.collected_at;
const createdAt = Date.parse(`${collectedAt}T00:00:00Z`);
let inserted = 0;
let skipped = 0;
for (const o of obs.observations) {
  const header = `【来源】${o.company} · ${o.url} · source=${o.sourceType} · 采集日 ${collectedAt}`;
  const ok = dbMod.insertRawJdObservation({
    jobId: o.jobId,
    rawText: `${header}\n${o.rawText}`,
    parsedSkills: o.parsedSkills,
    source: "manual",
    createdAt,
  });
  if (ok) inserted += 1;
  else skipped += 1;
}
console.log(
  `raw_jd_observations：新增 ${inserted} 条，去重跳过 ${skipped} 条（共 ${obs.observations.length} 条观察）`
);
