#!/usr/bin/env node
/**
 * 生产启动入口（供云托管 / PM2 等单端口环境使用）。
 *
 * 为什么要这个文件：部分托管环境的启动命令不会展开 shell 变量
 * （`-p $PORT` 会原样传参并报 "argument missing"）。这里在 Node 内
 * 读 process.env.PORT 并显式传给 next start，避免依赖 shell 展开。
 *
 * 用法：node scripts/start.mjs
 *   PORT 默认 3000；HOSTNAME 绑定 0.0.0.0。
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = String(process.env.PORT || 3000);
// 只认自己声明的 BIND_HOST，不读 HOSTNAME —— 容器/沙箱常把 HOSTNAME 设成
// 容器名（如 VM-16-6-tencentos），传给 next -H 会 getaddrinfo ENOTFOUND。
const host = process.env.BIND_HOST || "0.0.0.0";

const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");

const child = spawn(
  process.execPath,
  ["--experimental-sqlite", nextBin, "start", "-p", port, "-H", host],
  { cwd: ROOT, stdio: "inherit", env: process.env },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
