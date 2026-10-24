#!/usr/bin/env node
/**
 * Create a consistent SQLite backup while the application is running.
 *
 * Usage:
 *   node --experimental-sqlite scripts/backup-db.mjs
 *
 * CAREER_DB_PATH selects the live database. CAREER_BACKUP_DIR selects the
 * destination directory; by default it is a `backups` directory beside the DB.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const databasePath = path.resolve(process.env.CAREER_DB_PATH || path.join(process.cwd(), "career.db"));
const backupDirectory = path.resolve(
  process.env.CAREER_BACKUP_DIR || path.join(path.dirname(databasePath), "backups"),
);
const keepCount = Number(process.env.CAREER_BACKUP_KEEP_COUNT || 30);

if (!Number.isSafeInteger(keepCount) || keepCount < 1) {
  throw new Error("CAREER_BACKUP_KEEP_COUNT 必须是大于 0 的整数。");
}

if (!fs.existsSync(databasePath)) {
  throw new Error(`数据库文件不存在：${databasePath}`);
}

fs.mkdirSync(backupDirectory, { recursive: true });

const timestamp = new Date().toISOString().replaceAll(":", "-");
const backupPath = path.join(backupDirectory, `career-${timestamp}.db`);
const temporaryPath = `${backupPath}.partial`;
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

function pruneBackups() {
  const backupName = /^career-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.db$/;
  const backups = fs.readdirSync(backupDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && backupName.test(entry.name))
    .map((entry) => {
      const filePath = path.join(backupDirectory, entry.name);
      return { filePath, modifiedAt: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  for (const stale of backups.slice(keepCount)) {
    try { fs.rmSync(stale.filePath); } catch { console.warn(`旧备份未能清理：${stale.filePath}`); }
  }
}

let source;
try {
  source = new DatabaseSync(databasePath);
  source.exec("PRAGMA busy_timeout = 5000;");
  // VACUUM INTO reads a transactionally consistent snapshot, including committed WAL data.
  source.exec(`VACUUM INTO ${sqlString(temporaryPath)};`);
} catch (error) {
  try { fs.rmSync(temporaryPath, { force: true }); } catch { /* Preserve the original error. */ }
  throw error;
} finally {
  source?.close();
}

let copy;
try {
  copy = new DatabaseSync(temporaryPath);
  const rows = copy.prepare("PRAGMA quick_check;").all();
  if (rows.length !== 1 || rows[0].quick_check !== "ok") {
    throw new Error(`备份完整性检查失败：${JSON.stringify(rows)}`);
  }
  copy.close();
  copy = undefined;
  fs.chmodSync(temporaryPath, 0o600);
  fs.renameSync(temporaryPath, backupPath);
  pruneBackups();
  console.log(`备份完成，完整性检查通过：${backupPath}`);
} catch (error) {
  copy?.close();
  try { fs.rmSync(temporaryPath, { force: true }); } catch { /* Preserve the original error. */ }
  throw error;
}
