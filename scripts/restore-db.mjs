#!/usr/bin/env node
/**
 * Restore a previously verified SQLite backup.
 *
 * Stop the application before running this command. The current DB is copied
 * into the backup directory first, then the selected backup is installed.
 *
 * Usage:
 *   node --experimental-sqlite scripts/restore-db.mjs /backups/career-....db
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const databasePath = path.resolve(process.env.CAREER_DB_PATH || path.join(process.cwd(), "career.db"));
const backupDirectory = path.resolve(
  process.env.CAREER_BACKUP_DIR || path.join(path.dirname(databasePath), "backups"),
);
const backupPath = process.argv[2] ? path.resolve(process.argv[2]) : "";

if (!backupPath) {
  throw new Error("请提供备份文件路径，例如：/backups/career-2026-10-22T03-00-00.000Z.db");
}

const relativeBackupPath = path.relative(backupDirectory, backupPath);
if (!relativeBackupPath || relativeBackupPath.startsWith("..") || path.isAbsolute(relativeBackupPath)) {
  throw new Error(`只能从备份目录恢复：${backupDirectory}`);
}
if (!fs.existsSync(backupPath)) throw new Error(`备份文件不存在：${backupPath}`);
if (backupPath === databasePath) throw new Error("备份文件不能与当前数据库相同。");

function verifyDatabase(filePath) {
  const connection = new DatabaseSync(filePath);
  try {
    const rows = connection.prepare("PRAGMA quick_check;").all();
    if (rows.length !== 1 || rows[0].quick_check !== "ok") {
      throw new Error(`数据库完整性检查失败：${JSON.stringify(rows)}`);
    }
  } finally {
    connection.close();
  }
}

// Validate before touching the current database.
verifyDatabase(backupPath);

const timestamp = new Date().toISOString().replaceAll(":", "-");
const temporaryPath = `${databasePath}.${timestamp}.restore-partial`;
const previousPath = `${databasePath}.${timestamp}.pre-restore`;
const rollbackPath = path.join(backupDirectory, `career-before-restore-${timestamp}.db`);
let current;
let rollbackCreated = false;

try {
  if (fs.existsSync(databasePath)) {
    current = new DatabaseSync(databasePath);
    current.exec("PRAGMA busy_timeout = 5000;");
    const checkpoint = current.prepare("PRAGMA wal_checkpoint(TRUNCATE);").all()[0];
    if (checkpoint?.busy) {
      throw new Error("数据库仍有活动写入；请停止应用后再恢复。");
    }
    current.close();
    current = undefined;
    fs.copyFileSync(databasePath, rollbackPath);
    fs.chmodSync(rollbackPath, 0o600);
    rollbackCreated = true;
  }

  fs.copyFileSync(backupPath, temporaryPath);
  fs.chmodSync(temporaryPath, 0o600);
  verifyDatabase(temporaryPath);

  // The app must be stopped so no process retains or writes the old WAL files.
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${databasePath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
  }

  if (fs.existsSync(databasePath)) fs.renameSync(databasePath, previousPath);
  try {
    fs.renameSync(temporaryPath, databasePath);
  } catch (error) {
    if (fs.existsSync(previousPath)) fs.renameSync(previousPath, databasePath);
    throw error;
  }

  if (fs.existsSync(previousPath)) {
    try { fs.rmSync(previousPath); } catch { console.warn(`旧数据库临时文件未能清除：${previousPath}`); }
  }
  console.log(
    rollbackCreated
      ? `恢复完成，原数据库副本已保存在：${rollbackPath}`
      : "恢复完成；恢复前数据库不存在，因此没有生成回滚副本。",
  );
} catch (error) {
  current?.close();
  try { fs.rmSync(temporaryPath, { force: true }); } catch { /* Preserve the original error. */ }
  throw error;
}
