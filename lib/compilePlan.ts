/**
 * 把当前画像 + 岗位匹配结果 + 学习路径编译成可导出的 markdown
 */
import { resolveUrl } from "@/lib/links";
import type { JobMatch, PathItem } from "@/lib/matcher";
import { fmtWeeks, type Profile } from "@/lib/types";

function plainMarkdownText(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\[/g, "［")
    .replace(/\]/g, "］")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .trim();
}

export function compilePlan(p: Profile, m: JobMatch, path: PathItem[]): string {
  const lines: string[] = [];
  lines.push(`# 职途规划 · ${m.title}`, "");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN")}`);
  lines.push(`背景：${p.major || "未填"} ${p.grade || ""}`);
  lines.push(`每周可投入：${p.hoursPerWeek} 小时`);
  lines.push("");
  lines.push(`## 目标岗位`, "");
  lines.push(`- ${m.title}（${m.trackName}）`);
  if (m.source === "jd") {
    lines.push(`- JD 识别技能覆盖率：${m.coverage}%（规则识别，需对照原文复核）`);
    lines.push("- JD 未标技能权重，识别到的技能按等权计算；这不代表招聘方优先级。");
  } else {
    lines.push(`- 必备技能覆盖率：${m.coverage}%　匹配分：${m.score}`);
  }
  lines.push(`- 项目证据覆盖率：${m.evidenceCoverage}%（用户自评，未经外部核验）`);
  const totalHours = path.reduce((sum, item) => sum + item.estHours, 0);
  lines.push(`- 补技能与补作品：估算 ${totalHours} 小时，按每周 ${p.hoursPerWeek} 小时计 ${fmtWeeks(totalHours / Math.max(1, p.hoursPerWeek))}`);
  if (m.source !== "jd") {
    lines.push(`- 薪资参考：实习 ${m.salary.intern}　应届 ${m.salary.junior}`);
    lines.push(`- 入门门槛：${m.threshold}`);
  }
  lines.push("");
  lines.push(m.source === "jd" ? "## JD 已识别且自述具备的技能" : "## 自述已具备的必备技能", "");
  m.covered.forEach((s) => lines.push(m.source === "jd" ? `- ${s.name}（JD 等权）` : `- ${s.name}（权重 ${s.weight}）`));
  if (!m.covered.length) lines.push("- 暂无");
  lines.push("");
  lines.push(`## 接下来学什么`, "");
  if (!path.length) {
    lines.push(m.source === "jd" ? "- 当前 JD 未形成待补技能或作品行动；请逐条复核原文要求。" : "- 必备技能已全部覆盖，建议直接用真实 JD 做一次复核");
  } else {
    path.forEach((item, i) => {
      lines.push(m.source === "jd"
        ? `${i + 1}. ${item.name}（JD 等权排序，约 ${item.estHours} 小时，累计第 ${item.cumulativeWeeks} 周）`
        : `${i + 1}. ${item.name}（权重 ${item.weight}，约 ${item.estHours} 小时，累计第 ${item.cumulativeWeeks} 周）`);
      lines.push(`   - 类型：${item.kind === "learn" ? "补技能" : "补作品"}`);
      lines.push(`   - 交付物：${item.deliverable}`);
      lines.push(`   - 验收：${item.acceptance}`);
      lines.push(`   - 状态：${p.completedActions?.includes(`${m.jobId}:${item.skillId}:${item.kind}`) ? "已完成" : "待完成"}`);
      const review = p.actionReviews?.[`${m.jobId}:${item.skillId}:${item.kind}`];
      if (review) {
        if (review.artifact) lines.push(`   - 作品 / 材料：${plainMarkdownText(review.artifact)}`);
        if (review.location) lines.push(`   - 保存位置：${plainMarkdownText(review.location)}`);
        if (review.contribution) lines.push(`   - 我的贡献：${plainMarkdownText(review.contribution)}`);
        if (review.reflection) lines.push(`   - 过程复盘：${plainMarkdownText(review.reflection)}`);
        if (review.interest) lines.push(`   - 继续意愿：${review.interest === "continue" ? "愿意继续" : review.interest === "uncertain" ? "还不确定" : "暂时不想"}`);
      }
      item.resources.forEach((r) => {
        lines.push(`   - [${r.title}（${r.platform}）](${resolveUrl(r.platform, r.query)})`);
      });
    });
  }
  lines.push("");
  lines.push("---");
  lines.push(m.source === "jd"
    ? "说明：技能识别来自本地别名规则，可能漏识别或误命中；JD 未提供权重，故等权计算；时长为经验估算。"
    : "说明：匹配分 = 覆盖率×75% + 加分项×15% + 方向契合×10%；时长为经验估算，非精确值。");
  return lines.join("\n");
}
