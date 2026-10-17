"use client";

/**
 * 参赛提交中心（/submit）
 *
 * 依据第二届「新致杯」人工智能创新大赛参赛通知，集中呈现：
 * 提交入口、所需字段与格式、材料清单与要求、关键约束、提交后确认方式。
 * 本页只做信息呈现与提交包生成指引，不代发邮件、不代替主办方确认收件。
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import submissionConfig from "@/submission/submission.config.json";

const INBOX = submissionConfig.delivery.to;
const DEADLINE_LABEL = "2026 年 10 月 23 日 24:00";
const DEADLINE_AT = new Date("2026-10-23T23:59:59+08:00").getTime();

/** 从配置推导真实压缩包名与邮件主题，避免页面停留在占位符上。 */
const SEPARATOR = submissionConfig.packaging.separator;
const CAPTAIN_NAME = submissionConfig.project.captain.name;
const PROJECT_NAME = submissionConfig.project.name;
const REAL_ZIP_BASE = PROJECT_NAME && CAPTAIN_NAME ? `${PROJECT_NAME}${SEPARATOR}${CAPTAIN_NAME}` : "";

const DOC_SECTIONS = [
  ["产品介绍", "解决什么问题、给谁用、核心功能是什么"],
  ["设计思路", "为什么这样设计，替代方案是什么，取舍依据"],
  ["设计过程", "从需求到成品的推进路径与关键节点"],
  ["商业价值与/或产品创新性说明", "二选一或都写：差异化在哪里，价值如何成立"],
  ["AI Coding 工具使用情况", "工具名称 + 具体用途，成对提供"],
] as const;

const FIELDS: [string, string, string][] = [
  ["项目名称", "文本", "必填 · 决定压缩包文件名"],
  ["队长姓名", "文本", "必填 · 决定压缩包文件名"],
  ["队长联系电话", "文本", "必填 · 官方人员将电话沟通项目进展"],
  ["队长邮箱", "邮箱", "建议填写 · 便于接收沟通"],
  ["队员名单", "文本列表", "选填 · 含队长每队不超过 5 人"],
  ["指导教师", "文本", "选填 · 学生队伍可配 1 名"],
  ["所属行业领域", "枚举", "建议填写 · 金融 / 医疗 / 汽车 / 教育 / 法律等"],
  ["材料类型", "枚举", "必填 · 产品说明书 / 商业计划书，二选一"],
  ["Demo 形式", "枚举", "必填 · 视频 / 网站 / 其他"],
  ["AI 工具及用途", "键值对列表", "必填 · 通知明确要求注明名称及具体用途"],
];

function useCountdown() {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(DEADLINE_AT - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return left;
}

function Countdown() {
  const left = useCountdown();
  if (left === null) {
    return <span className="num text-muted">计算中…</span>;
  }
  if (left <= 0) {
    return <span className="num font-medium danger-text">已超过截止时间</span>;
  }
  const s = Math.floor(left / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (
    <span className="num font-medium text-accent-strong">
      剩余 {d} 天 {h} 时 {m} 分 {sec} 秒
    </span>
  );
}

function Section({
  index,
  title,
  desc,
  children,
}: {
  index: string;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card mb-4 p-5">
      <h2 className="mb-1 text-base font-semibold text-foreground">
        <span className="mr-2 text-muted">{index}</span>
        {title}
      </h2>
      {desc ? <p className="mb-4 text-xs leading-relaxed text-muted">{desc}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}

function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost px-3 py-1 text-xs"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1600);
          },
          () => setDone(false),
        );
      }}
    >
      {done ? "已复制" : label}
    </button>
  );
}

export default function SubmitPage() {
  const [zipName, setZipName] = useState(REAL_ZIP_BASE || "项目名称+队长姓名");

  return (
    <main className="app-shell min-h-screen px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            职途 · 参赛提交中心
          </h1>
          <p className="mt-1 text-xs text-muted">
            第二届「新致杯」人工智能创新大赛 · AI + 无限万象
          </p>
        </div>
        <Link href="/plan" className="btn btn-ghost inline-flex items-center gap-1 text-xs">
          ← 返回职途
        </Link>
      </header>

      <div className="card mb-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div>
            <div className="text-xs text-muted">预选赛作品提交截止</div>
            <div className="text-lg font-semibold text-foreground">{DEADLINE_LABEL}</div>
          </div>
          <div className="text-sm">
            <Countdown />
          </div>
        </div>
        <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted">
          逾期未提交将视为自动弃赛。以下要求全部来自主办方参赛通知；凡通知未作规定的，
          本页会明确标注为「未规定」，不替主办方补充规则。
        </p>
      </div>

      <div className="card mb-4 border-l-4 p-5" style={{ borderLeftColor: "var(--accent)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-foreground">当前提交状态</h2>
          <span className="text-xs text-muted">读取自 submission/submission.config.json</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <tbody>
              {[
                ["项目名称", PROJECT_NAME],
                ["参赛队长", CAPTAIN_NAME],
                ["联系电话", submissionConfig.project.captain.phone],
                ["联系邮箱", submissionConfig.project.captain.email],
                ["所属行业领域", submissionConfig.project.industry],
                ["队员", (submissionConfig.project.members ?? []).filter(Boolean).join("、") || "无"],
                ["指导教师", submissionConfig.project.advisor || "无"],
                ["材料类型", submissionConfig.materials.docType],
                ["Demo 形式", submissionConfig.materials.demoType],
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <td className="w-28 py-1.5 pr-3 align-top text-xs text-muted">{k}</td>
                  <td className="py-1.5 text-sm text-foreground">
                    {v ? (
                      <span className="num">{v}</span>
                    ) : (
                      <span className="danger-text">未填写 —— 会阻断打包</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 rounded-md border border-border p-3">
          <div className="mb-2 text-xs text-muted">
            提交时须注明的 AI Coding 工具（通知明确要求「名称 + 具体用途」）
          </div>
          <ul className="ml-4 list-disc space-y-1 text-xs leading-relaxed text-foreground">
            {submissionConfig.aiCoding.tools.map((t) => (
              <li key={t.name}>
                <span className="font-medium">{t.name}</span>
                ：{t.usage || <span className="danger-text">未填写用途</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Section
        index="01"
        title="提交入口"
        desc="通知只提供一种提交方式：邮件附件。没有在线表单，也没有提交系统。"
      >
        <table className="w-full text-sm">
          <tbody>
            {[
              ["收件邮箱", INBOX],
              ["提交方式", "将全部参赛文件打包为 zip，作为邮件附件发送"],
              ["邮件主题", "与压缩包同名（不含 .zip）"],
              ["压缩包文件名", REAL_ZIP_BASE ? `${REAL_ZIP_BASE}.zip` : "项目名称+队长姓名.zip"],
            ].map(([k, v]) => (
              <tr key={k} className="border-b border-border last:border-0">
                <td className="w-32 py-2 pr-3 align-top text-xs text-muted">{k}</td>
                <td className="py-2 text-sm text-foreground">
                  <span className="num break-all">{v}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 rounded-md border border-border bg-accent-soft p-3">
          <div className="mb-2 text-xs text-muted">压缩包命名预览（改完配置后以此为准）</div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className="input flex-1"
              style={{ minWidth: "12rem" }}
              value={zipName}
              onChange={(e) => setZipName(e.target.value)}
              aria-label="压缩包名称预览"
              placeholder="项目名称+队长姓名"
            />
            <span className="num text-sm text-foreground">.zip</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={`${zipName}.zip`} label="复制文件名" />
            <CopyButton text={zipName} label="复制邮件主题" />
            <a
              className="btn btn-primary px-3 py-1 text-xs"
              href={`mailto:${INBOX}?subject=${encodeURIComponent(zipName)}`}
            >
              打开邮件客户端
            </a>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            邮件客户端只能预填收件人与主题，<strong className="text-foreground">附件需手动添加</strong>。
            通知原文写作「项目名称 + 队长姓名.zip」，本项目按字面加号生成文件名；
            若主办方核对时不认加号，改 <span className="num">submission.config.json</span> 里的
            <span className="num"> packaging.separator</span> 为空字符串即可。
          </p>
        </div>
      </Section>

      <Section
        index="02"
        title="所需字段与格式"
        desc="以下字段写在 submission/submission.config.json 中，打包脚本据此生成提交包与包内《提交信息》。"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">字段</th>
                <th className="py-2 pr-3 font-medium">格式</th>
                <th className="py-2 font-medium">要求</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map(([name, fmt, req]) => (
                <tr key={name} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3 align-top text-foreground">{name}</td>
                  <td className="py-2 pr-3 align-top text-xs text-muted">{fmt}</td>
                  <td className="py-2 align-top text-xs text-muted">{req}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        index="03"
        title="材料清单与具体要求"
        desc="通知写明：两项均须提交，材料不完整视为弃赛。"
      >
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="tag w3">必交</span>
            <span className="text-sm font-medium text-foreground">
              产品说明书 或 商业计划书（二选一）
            </span>
          </div>
          <p className="mb-2 text-xs text-muted">内容须包含以下五项：</p>
          <ol className="ml-4 list-decimal space-y-1 text-sm text-foreground">
            {DOC_SECTIONS.map(([t, d]) => (
              <li key={t}>
                {t}
                <span className="ml-2 text-xs text-muted">{d}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="tag w3">必交</span>
            <span className="text-sm font-medium text-foreground">产品 Demo</span>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            通知原文为「视频、网站或其他形式均可」，未限定扩展名。若选网站形式，
            请在配置里填写可访问地址；若选视频，建议控制在 3 分钟内并确保评审无需安装即可播放。
          </p>
        </div>

        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-xs text-muted">
            材料投放约定：放进 <span className="num">submission/materials/</span>，按前缀归类
          </div>
          <table className="w-full text-sm">
            <tbody>
              {[
                ["doc-", "产品说明书 / 商业计划书", "恰好 1 份"],
                ["demo-", "产品 Demo", "至少 1 个"],
              ].map(([p, k, n]) => (
                <tr key={p} className="border-b border-border last:border-0">
                  <td className="num w-20 py-2 pr-3 text-foreground">{p}</td>
                  <td className="py-2 pr-3 text-xs text-muted">{k}</td>
                  <td className="py-2 text-xs text-muted">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        index="04"
        title="关键约束"
        desc="区分「主办方明示」与「主办方未规定」，避免把工程惯例当成赛事规则。"
      >
        <div className="mb-4">
          <div className="mb-2 text-sm font-medium text-foreground">主办方明示</div>
          <table className="w-full text-sm">
            <tbody>
              {[
                ["截止时间", "2026 年 10 月 23 日 24:00，逾期视为自动弃赛"],
                ["打包格式", "zip，作为邮件附件发送"],
                ["命名规范", REAL_ZIP_BASE ? `${REAL_ZIP_BASE}.zip，邮件主题同名` : "项目名称+队长姓名.zip，邮件主题同名"],
                ["材料完整性", "说明书/计划书 与 Demo 两项均须提交"],
                ["文件类型", "Demo「视频、网站或其他形式均可」，未限定扩展名"],
                ["AI 工具披露", "须注明 AI 工具名称及其具体用途"],
                ["队伍限制", "每人仅参加一个项目、一支队伍；每队不超过 5 人"],
                ["脱敏要求", "涉密内容须在参赛前脱敏处理"],
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <td className="w-28 py-2 pr-3 align-top text-xs text-muted">{k}</td>
                  <td className="py-2 text-sm text-foreground">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mb-4 rounded-md border border-border p-3">
          <div className="mb-2 text-sm font-medium text-foreground">主办方未规定</div>
          <ul className="ml-4 list-disc space-y-1 text-xs leading-relaxed text-muted">
            <li>附件大小上限（通知未给出任何数值）</li>
            <li>说明书 / 计划书的页数或字数</li>
            <li>材料语言（中文或英文均未限定）</li>
            <li>Demo 视频时长</li>
          </ul>
        </div>

        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-sm font-medium text-foreground">
            工程建议
            <span className="ml-2 text-xs font-normal text-muted">非主办方约束，仅供降低发送失败风险</span>
          </div>
          <ul className="ml-4 list-disc space-y-1 text-xs leading-relaxed text-muted">
            <li>提交包总量控制在 25MB 以内；超出时改用网盘链接并在邮件正文说明</li>
            <li>说明书导出为 PDF，避免评审端字体缺失导致错版</li>
            <li>Demo 视频使用 MP4（H.264），1080p 即可，码率过高会迅速撑爆附件上限</li>
            <li>不要放进源码、<span className="num">node_modules/</span> 与数据库文件</li>
          </ul>
        </div>
      </Section>

      <Section
        index="05"
        title="提交后的确认方式"
        desc="通知未提供自动回执或提交查询入口，以下为可自行执行的确认流程。"
      >
        <ol className="ml-4 list-decimal space-y-2 text-sm text-foreground">
          <li>
            发送后立即保留邮件「已发送」截图与附件列表截图，作为按时提交的凭证。
          </li>
          <li>
            保持队长电话畅通——通知写明官方人员将在比赛期间电话沟通项目进展。
          </li>
          <li>队长按通知要求扫码添加官方人员、加入官方赛事交流群，在群内确认材料是否收到。</li>
          <li>若 24 小时内未获任何回应，再次邮件询问并在群内同步。</li>
        </ol>
        <p className="mt-3 rounded-md border border-border p-3 text-xs leading-relaxed text-muted">
          说明：本页与打包脚本都无法代替主办方确认收件。项目只负责把包打对、把材料查全，
          最终是否被接收以主办方回复为准。
        </p>
      </Section>

      <Section index="06" title="操作步骤" desc="三条命令走完提交包生成。">
        <ol className="ml-4 list-decimal space-y-2 text-sm text-foreground">
          <li>
            填写 <span className="num">submission/submission.config.json</span>
            （队长姓名、电话、AI 工具用途为必填）。
          </li>
          <li>
            把材料放进 <span className="num">submission/materials/</span>，分别以
            <span className="num"> doc-</span> 与 <span className="num">demo-</span> 开头。
          </li>
          <li>
            运行 <span className="num">npm run submit:check</span> 校验，
            再用 <span className="num">npm run submit:build</span> 产出提交包。
          </li>
        </ol>
        <div className="mt-4 rounded-md border border-border p-3">
          <div className="mb-2 text-xs text-muted">产出物</div>
          <table className="w-full text-sm">
            <tbody>
              {[
                [`dist/submission/${REAL_ZIP_BASE || "项目名称+队长姓名"}.zip`, "可直接作为邮件附件发送"],
                ["dist/submission/SUBMISSION-REPORT.md", "校验结果、提交指引与可复制的邮件正文"],
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <td className="num py-2 pr-3 align-top text-xs text-foreground">{k}</td>
                  <td className="py-2 align-top text-xs text-muted">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          校验存在阻断项时脚本以非零退出码结束且不产出 zip，避免发出材料不完整的包。
          包内会自动附一份《提交信息》，列明 AI Coding 工具名称及具体用途。
        </p>
      </Section>

      <footer className="mt-12 border-t border-border pt-4 text-center text-[0.7rem] text-muted">
        提交入口：{INBOX} · 截止 {DEADLINE_LABEL} · 本页不代发邮件
      </footer>
    </main>
  );
}
