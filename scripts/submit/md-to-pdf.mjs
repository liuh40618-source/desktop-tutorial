#!/usr/bin/env node
/**
 * 把 submission/materials 下的 Markdown 材料导出为 PDF（便于评审跨设备查看）。
 *
 * 实现：Markdown → 自带样式的 HTML → Playwright Chromium 打印为 PDF。
 * 不引入新的运行时依赖（playwright 已是 devDependency）。
 *
 * 用法：
 *   node scripts/submit/md-to-pdf.mjs                      # 导出 materials/ 下全部 .md
 *   node scripts/submit/md-to-pdf.mjs <输入.md> [输出.pdf]  # 导出指定文件
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MATERIALS_DIR = join(ROOT, "submission", "materials");
const OUT_DIR = join(ROOT, "dist", "submission", "pdf");

/* ---------- 极简 Markdown 渲染（覆盖说明书实际用到的语法） ---------- */

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 行内：`code`、**bold**、*em*、[text](url)、裸 URL */
function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_, p, c) => `${p}<em>${c}</em>`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => `<a href="${h}">${t}</a>`);
  out = out.replace(
    /(^|[\s(])(https?:\/\/[^\s<）)]+)/g,
    (_, p, u) => `${p}<a href="${u}">${u}</a>`,
  );
  return out;
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let i = 0;
  let inList = null; // "ul" | "ol"
  let para = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (inList) {
      html.push(`</${inList}>`);
      inList = null;
    }
  };

  const splitRow = (row) =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (/^```/.test(line)) {
      flushPara();
      closeList();
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      html.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // 表格
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      flushPara();
      closeList();
      const head = splitRow(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        body.push(splitRow(lines[i]));
        i += 1;
      }
      html.push("<table><thead><tr>");
      html.push(head.map((c) => `<th>${inline(c)}</th>`).join(""));
      html.push("</tr></thead><tbody>");
      for (const row of body) {
        html.push(`<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`);
      }
      html.push("</tbody></table>");
      continue;
    }

    // 分隔线
    if (/^\s*---+\s*$/.test(line)) {
      flushPara();
      closeList();
      html.push("<hr>");
      i += 1;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      flushPara();
      closeList();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      html.push(`<blockquote>${renderMarkdown(buf.join("\n"))}</blockquote>`);
      continue;
    }

    // 列表
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? "ul" : "ol";
      if (inList !== want) {
        closeList();
        html.push(`<${want}>`);
        inList = want;
      }
      html.push(`<li>${inline((ul || ol)[1])}</li>`);
      i += 1;
      continue;
    }

    // 空行
    if (/^\s*$/.test(line)) {
      flushPara();
      closeList();
      i += 1;
      continue;
    }

    para.push(line);
    i += 1;
  }

  flushPara();
  closeList();
  return html.join("\n");
}

const PAGE_CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif;
    font-size: 10.5pt; line-height: 1.75; color: #1a1a1a; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 20pt; margin: 0 0 14pt; padding-bottom: 6pt; border-bottom: 2px solid #333; }
  h2 { font-size: 14pt; margin: 20pt 0 8pt; padding-bottom: 4pt; border-bottom: 1px solid #ccc; page-break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 14pt 0 6pt; page-break-after: avoid; }
  h4 { font-size: 10.5pt; margin: 12pt 0 4pt; page-break-after: avoid; }
  p { margin: 6pt 0; }
  ul, ol { margin: 6pt 0; padding-left: 20pt; }
  li { margin: 3pt 0; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 9.5pt; page-break-inside: avoid; }
  th, td { border: 1px solid #d0d0d0; padding: 5pt 7pt; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; }
  code { font-family: "Cascadia Mono", Consolas, "Courier New", monospace; font-size: 9pt;
         background: #f4f4f4; padding: 1pt 4pt; border-radius: 3px; }
  pre { background: #f7f7f7; border: 1px solid #e0e0e0; border-radius: 4px;
        padding: 8pt 10pt; overflow-x: auto; page-break-inside: avoid; }
  pre code { background: none; padding: 0; font-size: 8.5pt; line-height: 1.5; }
  blockquote { margin: 8pt 0; padding: 6pt 12pt; border-left: 3px solid #999;
               background: #fafafa; color: #333; }
  blockquote p { margin: 3pt 0; }
  hr { border: none; border-top: 1px solid #ddd; margin: 14pt 0; }
  a { color: #0b57d0; text-decoration: none; word-break: break-all; }
  strong { font-weight: 600; }
`;

async function renderPdf(browser, mdPath, outPath) {
  const md = readFileSync(mdPath, "utf8");
  const body = renderMarkdown(md);
  const title = escapeHtml(basename(mdPath, extname(mdPath)));
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${title}</title><style>${PAGE_CSS}</style></head><body>${body}</body></html>`;

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({
    path: outPath,
    format: "A4",
    printBackground: true,
    margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate:
      '<div style="width:100%;font-size:8pt;color:#888;padding:0 16mm;text-align:right;">' +
      `${title} · 第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>`,
  });
  await page.close();
}

async function main() {
  const args = process.argv.slice(2);
  let targets = [];

  if (args.length > 0 && !args[0].startsWith("--")) {
    const input = resolve(args[0]);
    if (!existsSync(input)) {
      console.error(`找不到输入文件：${input}`);
      process.exit(1);
    }
    const output = args[1] ? resolve(args[1]) : join(OUT_DIR, `${basename(input, extname(input))}.pdf`);
    targets = [{ input, output }];
  } else {
    if (!existsSync(MATERIALS_DIR)) {
      console.error(`找不到材料目录：${MATERIALS_DIR}`);
      process.exit(1);
    }
    targets = readdirSync(MATERIALS_DIR)
      .filter((n) => extname(n).toLowerCase() === ".md" && !/^readme$/i.test(basename(n, ".md")))
      .map((n) => ({
        input: join(MATERIALS_DIR, n),
        output: join(OUT_DIR, `${basename(n, ".md")}.pdf`),
      }));
  }

  if (targets.length === 0) {
    console.log("没有找到可导出的 .md 材料。");
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const { input, output } of targets) {
      await renderPdf(browser, input, output);
      const kb = (statSync(output).size / 1024).toFixed(1);
      console.log(`✓ ${basename(input)} → ${output} (${kb} KB)`);
    }
  } finally {
    await browser.close();
  }
}

main();
