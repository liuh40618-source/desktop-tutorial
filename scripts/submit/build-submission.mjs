#!/usr/bin/env node
/**
 * 第二届「新致杯」人工智能创新大赛 · 参赛提交包构建器
 *
 * 职责：
 *   1. 校验 submission/submission.config.json 的必填字段
 *   2. 校验 submission/materials/ 的材料完整性（说明书/BP 二选一 + Demo 必交）
 *   3. 按通知要求命名，产出 dist/submission/<项目名称>+<队长姓名>.zip
 *   4. 生成提交核对报告与邮件正文
 *
 * 用法：
 *   node scripts/submit/build-submission.mjs           # 校验 + 打包
 *   node scripts/submit/build-submission.mjs --check   # 仅校验，不产出 zip
 *
 * 退出码：0 = 通过；1 = 存在阻断项，不可提交。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./lib/zip.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SUBMIT_DIR = join(ROOT, "submission");
const CONFIG_PATH = join(SUBMIT_DIR, "submission.config.json");
const MATERIALS_DIR = join(SUBMIT_DIR, "materials");
const OUT_DIR = join(ROOT, "dist", "submission");

const DEADLINE_LABEL = "2026年10月23日 24:00";
const DEADLINE_AT = new Date("2026-10-23T23:59:59+08:00");
const OFFICIAL_INBOX = "marketing@newtouch.com";

const DOC_EXTS = new Set([".pdf", ".doc", ".docx", ".md", ".txt", ".ppt", ".pptx"]);
const DEMO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".html", ".zip", ".rar", ".7z"]);
const SKIP_NAMES = new Set(["readme.md", ".gitkeep", ".ds_store", "thumbs.db"]);

const CHECK_ONLY = process.argv.includes("--check");

const errors = [];
const warnings = [];
const notes = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const note = (m) => notes.push(m);

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function sanitizeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|\r\n\t]/g, "").trim();
}

function classify(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.startsWith("doc")) return "doc";
  if (lower.startsWith("demo")) return "demo";
  const ext = extname(lower);
  if (DEMO_EXTS.has(ext)) return "demo";
  if (DOC_EXTS.has(ext)) return "doc";
  return null;
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) {
    err(`找不到配置文件：${CONFIG_PATH}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    err(`配置文件不是合法 JSON：${e.message}`);
    return null;
  }
}

function collectMaterials() {
  if (!existsSync(MATERIALS_DIR)) {
    err(`找不到材料目录：${MATERIALS_DIR}`);
    return [];
  }
  const out = [];
  for (const name of readdirSync(MATERIALS_DIR)) {
    if (SKIP_NAMES.has(name.toLowerCase()) || name.startsWith(".")) continue;
    const abs = join(MATERIALS_DIR, name);
    if (!statSync(abs).isFile()) {
      warn(`跳过子目录（提交包只收文件）：materials/${name}`);
      continue;
    }
    const kind = classify(name);
    const size = statSync(abs).size;
    if (kind === null) {
      err(`无法归类：materials/${name} —— 文件名需以 doc- 或 demo- 开头（见 submission/README.md）`);
      continue;
    }
    if (!/^(doc|demo)/i.test(name)) {
      warn(`materials/${name} 未使用 doc-/demo- 前缀，已按扩展名推断为「${kind === "doc" ? "说明书" : "Demo"}」，建议改名以免歧义`);
    }
    out.push({ name, abs, kind, size, base: basename(name, extname(name)).toLowerCase() });
  }

  // 同名 .md + .pdf 并存时只收 PDF（跨设备查看不错版），避免包内出现两份同内容材料
  const pdfBases = new Set(out.filter((m) => extname(m.name).toLowerCase() === ".pdf").map((m) => m.base));
  const kept = out.filter((m) => {
    const ext = extname(m.name).toLowerCase();
    if ((ext === ".md" || ext === ".markdown") && pdfBases.has(m.base)) {
      note(`materials/${m.name} 已有同名 PDF，按 PDF 优先打包，跳过 Markdown 源文件`);
      return false;
    }
    return true;
  });
  return kept;
}

function validate(cfg, materials) {
  const p = cfg.project ?? {};
  const captain = p.captain ?? {};
  const ai = cfg.aiCoding ?? {};
  const mat = cfg.materials ?? {};

  if (!p.name || !String(p.name).trim()) err("project.name（项目名称）为空，压缩包无法命名");
  if (!p.industry || !String(p.industry).trim()) warn("project.industry（所属行业领域）为空，通知建议明确行业方向");
  if (!captain.name || !String(captain.name).trim()) err("project.captain.name（队长姓名）为空，压缩包无法命名");
  if (!captain.phone || !String(captain.phone).trim()) err("project.captain.phone（队长电话）为空；通知要求官方人员将电话沟通项目进展");
  if (!captain.email || !String(captain.email).trim()) warn("project.captain.email 为空，建议填写以便接收回执");

  const members = Array.isArray(p.members) ? p.members : [];
  const teamSize = members.length + 1;
  if (teamSize > 5) err(`队伍人数为 ${teamSize} 人（含队长），超过通知规定的每队不超过 5 人`);
  if (members.some((m) => !m || !String(m).trim())) warn("project.members 中存在空项，请清理");

  const tools = Array.isArray(ai.tools) ? ai.tools.filter((t) => t && t.name) : [];
  if (tools.length === 0) {
    err("aiCoding.tools 为空；通知明确要求「提交时请注明所使用的 AI 工具名称及其具体用途」");
  } else {
    const missingUsage = tools.filter((t) => !t.usage || !String(t.usage).trim());
    if (missingUsage.length > 0) {
      err(`以下 AI 工具缺少 usage 用途说明：${missingUsage.map((t) => t.name).join("、")}；通知要求「名称 + 具体用途」成对提供`);
    }
  }

  const docType = mat.docType || "产品说明书";
  if (!["产品说明书", "商业计划书"].includes(docType)) {
    warn(`materials.docType = "${docType}" 不是「产品说明书」或「商业计划书」，通知要求二选一`);
  }

  const docs = materials.filter((m) => m.kind === "doc");
  const demos = materials.filter((m) => m.kind === "demo");

  if (docs.length === 0) err(`未找到${docType}：请在 materials/ 放入 1 份 doc- 开头的文件`);
  if (docs.length > 1) err(`找到 ${docs.length} 份说明书/计划书（${docs.map((d) => d.name).join("、")}），通知要求二选一，请只保留 1 份`);
  if (demos.length === 0) err("未找到产品 Demo：请在 materials/ 放入至少 1 个 demo- 开头的文件");

  for (const d of docs) {
    const ext = extname(d.name).toLowerCase();
    if (ext !== ".pdf") {
      warn(`${d.name} 不是 PDF。通知未限定格式，但 PDF 在跨设备查看时最不易错版`);
    } else {
      note(`${d.name} 为 PDF：字体已内嵌，评审端不会因缺字体而错版`);
    }
  }

  if (mat.demoType === "网站") {
    if (!mat.demoUrl || !String(mat.demoUrl).trim()) {
      err("materials.demoType 为「网站」但 demoUrl 为空；请填写可访问地址，或改为提交视频");
    } else if (!/^https?:\/\//i.test(String(mat.demoUrl).trim())) {
      err(`materials.demoUrl 不是合法 http(s) 地址：${mat.demoUrl}`);
    } else {
      note(`Demo 为网站形式，评审访问地址：${mat.demoUrl}`);
    }
  }

  const total = materials.reduce((s, m) => s + m.size, 0);
  const limit = Number(cfg.packaging?.maxTotalBytes) || 25 * 1024 * 1024;
  if (total > limit) {
    warn(
      `材料合计 ${fmtBytes(total)}，超过本项目建议阈值 ${fmtBytes(limit)}（非主办方规定）。` +
        `建议改用网盘链接并在邮件正文说明，或压缩视频码率。`,
    );
  }

  const now = new Date();
  const daysLeft = Math.ceil((DEADLINE_AT - now) / 86400000);
  if (now > DEADLINE_AT) {
    err(`已超过提交截止时间 ${DEADLINE_LABEL}（逾期视为自动弃赛）`);
  } else if (daysLeft <= 3) {
    warn(`距截止仅剩 ${daysLeft} 天，建议尽快发送`);
  }

  return { docs, demos, tools, total, docType };
}

function buildInfoSheet(cfg, docs, demos, tools, total) {
  const p = cfg.project ?? {};
  const captain = p.captain ?? {};
  const mat = cfg.materials ?? {};
  const members = (p.members ?? []).filter(Boolean);
  const stamp = new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });

  const lines = [
    "# 提交信息",
    "",
    `- 参赛赛事：第二届「新致杯」人工智能创新大赛（AI + 无限万象）`,
    `- 项目名称：${p.name}`,
    `- 所属行业领域：${p.industry || "（未填写）"}`,
    `- 队长：${captain.name}（${captain.phone}${captain.email ? ` / ${captain.email}` : ""}）`,
    `- 队员：${members.length > 0 ? members.join("、") : "无"}`,
    `- 指导教师：${p.advisor || "无"}`,
    `- 材料类型：${mat.docType}（二选一） + 产品 Demo（${mat.demoType || "未填写"}）`,
    ...(mat.demoType === "网站" && mat.demoUrl ? [`- Demo 访问地址：${mat.demoUrl}`] : []),
    `- 生成时间：${stamp}（GMT+8）`,
    `- 提交截止：${DEADLINE_LABEL}`,
    "",
    "## AI Coding 工具使用情况",
    "",
    "> 通知要求：参赛作品须使用 AI Coding 工具完成，提交时须注明所使用的 AI 工具名称及其具体用途。",
    "",
    "| AI 工具 | 具体用途 |",
    "| --- | --- |",
    ...tools.map((t) => `| ${t.name} | ${t.usage} |`),
    "",
    "## 材料清单",
    "",
    "| 文件 | 类别 | 大小 |",
    "| --- | --- | --- |",
    ...docs.map((d) => `| ${d.name} | ${mat.docType} | ${fmtBytes(d.size)} |`),
    ...demos.map((d) => `| ${d.name} | 产品 Demo | ${fmtBytes(d.size)} |`),
    "",
    `材料合计：${fmtBytes(total)}`,
    "",
    "## 说明",
    "",
    "本文件由 `scripts/submit/build-submission.mjs` 依据 `submission/submission.config.json` 自动生成。",
    "",
  ];
  return lines.join("\n");
}

/** 源码子包：排除依赖、构建产物、数据库、日志与已单独提交的材料 */
const SOURCE_SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  ".git",
  ".workbuddy-ai",
  "submission",
  "coverage",
  ".vercel",
  ".turbo",
]);
const SOURCE_SKIP_FILES = new Set([
  "career.db",
  "career.db-shm",
  "career.db-wal",
  "dev-log.txt",
  "dev-workspace.log",
  "dev-workspace-error.log",
  "tsconfig.tsbuildinfo",
]);
const SOURCE_MAX_FILE_BYTES = 2 * 1024 * 1024;

function collectSourceEntries(prefix = "源码") {
  const files = [];
  let skipped = 0;

  function walk(dir, rel) {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const st = statSync(abs);
      const childRel = rel ? `${rel}/${name}` : name;

      if (st.isDirectory()) {
        if (name.startsWith(".") || SOURCE_SKIP_DIRS.has(name)) {
          skipped += 1;
          continue;
        }
        walk(abs, childRel);
        continue;
      }

      if (name.startsWith(".")) {
        skipped += 1;
        continue;
      }
      if (SOURCE_SKIP_FILES.has(name)) {
        skipped += 1;
        continue;
      }
      if (/\.(db|db-shm|db-wal|bak)$/i.test(name) || /\.db\.[^/]+$/i.test(name)) {
        skipped += 1;
        continue;
      }
      if (st.size > SOURCE_MAX_FILE_BYTES) {
        skipped += 1;
        continue;
      }

      files.push({ name: `${prefix}/${childRel}`, data: readFileSync(abs) });
    }
  }

  walk(ROOT, "");
  const bytes = files.reduce((s, f) => s + f.data.length, 0);
  return { files, skipped, bytes };
}

function buildEntryHtml(cfg) {
  const p = cfg.project ?? {};
  const captain = p.captain ?? {};
  const mat = cfg.materials ?? {};
  const url = String(mat.demoUrl || "").trim();
  const safeUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const tools = (cfg.aiCoding?.tools ?? []).filter((t) => t && t.name);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p.name} · 参赛材料入口</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 24px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
    background: #f7f7f5; color: #1a1a1a; line-height: 1.65;
  }
  .wrap { max-width: 720px; margin: 0 auto; }
  .card {
    background: #fff; border: 1px solid #e3e3df; border-radius: 14px;
    padding: 36px 40px; margin-bottom: 20px;
  }
  h1 { font-size: 26px; margin: 0 0 6px; font-weight: 600; letter-spacing: -0.01em; }
  .sub { color: #6b6b66; font-size: 14px; margin: 0 0 28px; }
  .cta {
    display: block; text-align: center; text-decoration: none;
    background: #1a1a1a; color: #fff; font-size: 17px; font-weight: 500;
    padding: 18px 24px; border-radius: 10px; margin: 24px 0 12px;
  }
  .cta:hover { background: #000; }
  .urlline {
    font-family: ui-monospace, Consolas, monospace; font-size: 12.5px;
    color: #4a4a46; background: #f4f4f1; border: 1px solid #e3e3df;
    border-radius: 8px; padding: 12px 14px; word-break: break-all;
    user-select: all; margin: 0 0 8px;
  }
  h2 { font-size: 15px; margin: 32px 0 12px; font-weight: 600; }
  ol, ul { margin: 0; padding-left: 22px; font-size: 14px; }
  li { margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; margin-top: 8px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #ededE9; }
  th { color: #6b6b66; font-weight: 500; font-size: 12.5px; }
  td:first-child { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
  .note { font-size: 13px; color: #6b6b66; margin-top: 10px; }
  .tag {
    display: inline-block; font-size: 12px; padding: 2px 9px; border-radius: 999px;
    background: #eef4e6; color: #3b6d11; margin-left: 8px; vertical-align: 2px;
  }
</style>
</head>
<body>
<div class="wrap">

  <div class="card">
    <h1>${p.name} · 参赛材料入口</h1>
    <p class="sub">
      第二届「新致杯」人工智能创新大赛　|　队长：${captain.name}　${captain.phone}
    </p>

    <p style="font-size:15px;margin:0">
      本产品是<b>在线网站</b>，无需安装、无需注册、无需 API Key。
      点击下面的按钮即可直接体验完整流程。
    </p>

    <a class="cta" href="${safeUrl}" target="_blank" rel="noopener">打开在线产品 Demo →</a>
    <p class="urlline">${safeUrl || "（未配置 demoUrl）"}</p>
    <p class="note">
      若首次打开稍慢，请等待 3–5 秒（服务冷启动）。如按钮无响应，请把上面的地址复制到浏览器地址栏。
    </p>

    <h2>推荐体验路径（约 3 分钟）</h2>
    <ol>
      <li>进入后点「<b>试一段示例</b>」——无需准备数据，直接走完全流程。</li>
      <li>「01 看见经历」填一段做过的事 → 点「记好了，去核对能力」。</li>
      <li>逐条确认候选能力，<b>可故意否认一条</b>——系统给候选，用户做确认。</li>
      <li>「02 比较选择」切换 2–3 个方向，展开任意岗位卡看<b>分项构成</b>。</li>
      <li>「03 动手验证」查看含交付物与验收标准的行动，勾选并写复盘。</li>
    </ol>

    <h2>三个值得注意的点</h2>
    <ul>
      <li><b>每个数字都能拆开看。</b>匹配分 = 覆盖率 75% + 加分项 15% + 方向契合 10%，每项理由可见。</li>
      <li><b>主流程不调用大模型。</b>匹配基于本地规则与知识库，断网可运行、结果可复现。</li>
      <li><b>系统给候选，用户做确认。</b>不做自动判定，人在决策链路里。</li>
    </ul>
  </div>

  <div class="card">
    <h2 style="margin-top:0">压缩包内容</h2>
    <table>
      <tr><th>文件</th><th>说明</th></tr>
      <tr><td>00-请先打开我.html</td><td>本页，含在线 Demo 入口</td></tr>
      <tr><td>01-提交信息.md</td><td>队长信息、Demo 地址、AI 工具名称及用途</td></tr>
      <tr><td>doc-${p.name}产品说明书.pdf</td><td>参赛材料（说明书 / 商业计划书 二选一）</td></tr>
      <tr><td>demo-产品Demo访问说明.pdf</td><td>Demo 访问说明与推荐体验路径</td></tr>
      <tr><td>源码/</td><td>完整产品源码，可离线复现</td></tr>
    </table>
    <p class="note">
      源码为 Demo 的离线凭证：即使在线地址不可达，也可按 <code>源码/README.md</code>
      在本地启动同一产品。
    </p>

    <h2>AI Coding 工具<span class="tag">通知要求注明</span></h2>
    <table>
      <tr><th>工具</th><th>具体用途</th></tr>
      ${tools.map((t) => `<tr><td>${t.name}</td><td>${t.usage}</td></tr>`).join("\n      ")}
    </table>
  </div>

</div>
</body>
</html>
`;
}

function buildEmailBody(cfg, zipName) {
  const p = cfg.project ?? {};
  const captain = p.captain ?? {};
  return [
    `收件人：${cfg.delivery?.to || OFFICIAL_INBOX}`,
    `邮件主题：${zipName.replace(/\.zip$/i, "")}`,
    "",
    "正文：",
    "",
    "您好，",
    "",
    `附件为「${p.name}」参加第二届“新致杯”人工智能创新大赛的参赛材料，压缩包文件名与邮件主题一致。`,
    "",
    `- 项目名称：${p.name}`,
    `- 所属行业领域：${p.industry || "（未填写）"}`,
    `- 队长：${captain.name}　联系电话：${captain.phone}`,
    `- 材料构成：${(cfg.materials?.docType) || "产品说明书"} + 产品 Demo`,
    "",
    "包内另附《提交信息》，列明 AI Coding 工具名称及具体用途。",
    "",
    "如材料有任何缺漏，请随时与我联系。谢谢！",
    "",
    captain.name,
    "",
  ].join("\n");
}

function buildReport(cfg, docs, demos, tools, total, zipName, zipSize, wroteZip, sourceStats) {
  const p = cfg.project ?? {};
  const captain = p.captain ?? {};
  const members = (p.members ?? []).filter(Boolean);
  const now = new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });

  return [
    "# 新致杯参赛提交报告",
    "",
    `生成时间：${now}（GMT+8）　截止时间：${DEADLINE_LABEL}`,
    "",
    "## 一、校验结果",
    "",
    errors.length === 0 ? "- 阻断项：无" : errors.map((e) => `- **阻断** ${e}`).join("\n"),
    warnings.length === 0 ? "- 提醒项：无" : warnings.map((w) => `- 提醒 ${w}`).join("\n"),
    notes.length === 0 ? "" : notes.map((n) => `- 说明 ${n}`).join("\n"),
    "",
    errors.length === 0
      ? "**结论：材料完整，可以提交。**"
      : `**结论：存在 ${errors.length} 项阻断问题，现在提交会被视为材料不完整，请先修复。**`,
    "",
    "## 二、提交入口",
    "",
    `- 收件邮箱：${cfg.delivery?.to || OFFICIAL_INBOX}`,
    `- 提交方式：邮件附件（zip）`,
    `- 邮件主题：${zipName.replace(/\.zip$/i, "")}`,
    `- 压缩包文件名：${zipName}`,
    `- 截止时间：${DEADLINE_LABEL}，逾期未提交视为自动弃赛`,
    "",
    "## 三、提交包内容",
    "",
    "| 文件 | 类别 | 大小 |",
    "| --- | --- | --- |",
    ...(cfg.packaging?.includeEntryHtml === false ? [] : ["| 00-请先打开我.html | 材料入口页（内嵌 Demo 链接） | — |"]),
    ...(cfg.packaging?.includeInfoSheet === false ? [] : ["| 01-提交信息.md | 自动生成 | — |"]),
    ...docs.map((d) => `| ${d.name} | ${cfg.materials?.docType} | ${fmtBytes(d.size)} |`),
    ...demos.map((d) => `| ${d.name} | 产品 Demo | ${fmtBytes(d.size)} |`),
    ...(sourceStats?.count > 0
      ? [`| 源码/ | 完整产品源码（${sourceStats.count} 个文件） | ${fmtBytes(sourceStats.bytes)} |`]
      : []),
    "",
    wroteZip
      ? `产出文件：\`dist/submission/${zipName}\`（${fmtBytes(zipSize)}）`
      : "本次为 --check 模式，未产出 zip。",
    "",
    "## 四、所需字段",
    "",
    "| 字段 | 当前值 | 是否必填 |",
    "| --- | --- | --- |",
    `| 项目名称 | ${p.name || "（空）"} | 必填（决定压缩包名） |`,
    `| 队长姓名 | ${captain.name || "（空）"} | 必填（决定压缩包名） |`,
    `| 队长电话 | ${captain.phone || "（空）"} | 必填（官方将电话沟通） |`,
    `| 队长邮箱 | ${captain.email || "（空）"} | 建议填写 |`,
    `| 队员 | ${members.length > 0 ? members.join("、") : "（无）"} | 选填，含队长不超过 5 人 |`,
    `| 指导教师 | ${p.advisor || "（无）"} | 选填，学生队伍可配 1 名 |`,
    `| 所属行业领域 | ${p.industry || "（空）"} | 建议填写 |`,
    `| 材料类型 | ${cfg.materials?.docType || "（空）"} | 必填，说明书 / 商业计划书 二选一 |`,
    `| Demo 形式 | ${cfg.materials?.demoType || "（空）"} | 必填 |`,
    ...(cfg.materials?.demoType === "网站" && cfg.materials?.demoUrl
      ? [`| Demo 访问地址 | ${cfg.materials.demoUrl} | 建议填写，评审直接打开 |`]
      : []),
    `| AI 工具及用途 | ${tools.length} 项 | 必填，名称与用途成对 |`,
    "",
    "## 五、邮件正文（可直接复制）",
    "",
    "```text",
    buildEmailBody(cfg, zipName).trimEnd(),
    "```",
    "",
    "## 六、提交后的确认方式",
    "",
    "通知未提供自动回执或提交查询入口。可按以下顺序自行确认：",
    "",
    "1. 发送后保留邮件「已发送」截图与附件列表截图，作为按时提交的凭证。",
    "2. 保持队长电话畅通——通知写明官方人员将在比赛期间电话沟通项目进展。",
    "3. 队长扫码加入官方赛事交流群，在群内确认材料是否收到。",
    "4. 若 24 小时内未获任何回应，可再次邮件询问，并在群内同步。",
    "",
    "## 七、边界说明",
    "",
    "- 参赛通知**未规定**文件类型、大小上限、页数字数、语言。本报告中的 25MB 为工程建议值，不是主办方约束。",
    "- 通知**未提供**回执机制与提交查询入口，第六节的确认方式为建议流程。",
    "- 提交动作仍需本人从自有邮箱发出；本项目只负责把包打对、把材料查全。",
    "",
  ].join("\n");
}

function main() {
  console.log("═".repeat(56));
  console.log("  新致杯 · 参赛提交包构建");
  console.log(`  截止：${DEADLINE_LABEL}　模式：${CHECK_ONLY ? "仅校验" : "校验 + 打包"}`);
  console.log("═".repeat(56));

  const cfg = readConfig();
  if (!cfg) {
    report();
    process.exit(1);
  }

  const materials = collectMaterials();
  const { docs, demos, tools, total, docType } = validate(cfg, materials);

  const p = cfg.project ?? {};
  const captain = p.captain ?? {};
  const separator = cfg.packaging?.separator ?? "+";
  const base = sanitizeFileName(`${p.name ?? ""}${separator}${captain.name ?? ""}`);
  const zipName = base ? `${base}.zip` : "UNNAMED.zip";

  let wroteZip = false;
  let zipSize = 0;
  let entryCount = 0;
  let sourceStats = { count: 0, bytes: 0, skipped: 0 };

  if (errors.length === 0 && !CHECK_ONLY) {
    const entries = [];
    if (cfg.packaging?.includeEntryHtml !== false) {
      entries.push({
        name: "00-请先打开我.html",
        data: Buffer.from(buildEntryHtml(cfg), "utf8"),
      });
    }
    if (cfg.packaging?.includeInfoSheet !== false) {
      entries.push({
        name: "01-提交信息.md",
        data: Buffer.from(buildInfoSheet(cfg, docs, demos, tools, total), "utf8"),
      });
    }
    for (const m of materials) {
      entries.push({ name: m.name, data: readFileSync(m.abs) });
    }
    if (cfg.packaging?.includeSource !== false) {
      const src = collectSourceEntries();
      entries.push(...src.files);
      sourceStats = { count: src.files.length, bytes: src.bytes, skipped: src.skipped };
      note(
        `已打入源码 ${src.files.length} 个文件（${fmtBytes(src.bytes)}），跳过 ${src.skipped} 项依赖/产物/数据库/日志`,
      );
    }
    entryCount = entries.length;
    const zipBuf = createZip(entries);
    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, zipName), zipBuf);
    wroteZip = true;
    zipSize = zipBuf.length;
  }

  report();

  function report() {
    if (errors.length > 0) {
      console.log(`\n阻断项（${errors.length}）`);
      for (const e of errors) console.log(`  ✗ ${e}`);
    }
    if (warnings.length > 0) {
      console.log(`\n提醒项（${warnings.length}）`);
      for (const w of warnings) console.log(`  ! ${w}`);
    }
    if (errors.length === 0) {
      console.log(`\n材料校验通过：${docs.length} 份${docType} + ${demos.length} 个 Demo，合计 ${fmtBytes(total)}`);
      if (wroteZip) {
        console.log(`提交包已生成：dist/submission/${zipName}（${fmtBytes(zipSize)}）`);
        console.log(`邮件主题请填：${zipName.replace(/\.zip$/i, "")}`);
        console.log(`发送至：${cfg?.delivery?.to || OFFICIAL_INBOX}`);
      }
      console.log("报告：dist/submission/SUBMISSION-REPORT.md");
    } else {
      console.log("\n存在阻断项，未产出提交包。修复后重跑：npm run submit:build");
    }
    console.log("");
  }

  if (cfg) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      join(OUT_DIR, "SUBMISSION-REPORT.md"),
      buildReport(cfg, docs, demos, tools, total, zipName, zipSize, wroteZip, sourceStats),
      "utf8",
    );
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main();
