import { NextResponse } from "next/server";
import { auditPublicGithubRepository, parseGithubRepositoryUrl } from "@/lib/github-audit";
import { getUserProfile, saveUserProfile } from "@/lib/db";
import { readGuestOwner } from "@/lib/session";
import type { ActionEvaluation, GithubAudit, Profile } from "@/lib/types";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "访客会话已失效，请刷新页面后重试。" }, { status: 401 });
}

export async function POST(req: Request) {
  const ownerId = readGuestOwner(req);
  if (!ownerId) return unauthorized();
  try {
    const body = await req.json();
    const actionId = typeof body?.actionId === "string" ? body.actionId : "";
    const skillId = typeof body?.skillId === "string" ? body.skillId : "";
    if (!/^[A-Za-z0-9:_-]{1,200}$/.test(actionId) || !/^[a-z0-9-]{1,120}$/.test(skillId)) {
      return NextResponse.json({ ok: false, error: "行动或技能标识不合规。" }, { status: 400 });
    }
    if (!parseGithubRepositoryUrl(body?.githubUrl)) {
      return NextResponse.json({ ok: false, error: "GitHub 链接必须严格符合 https://github.com/用户名/仓库名，不得带查询参数、片段或尾斜杠。" }, { status: 400 });
    }
    const row = getUserProfile(ownerId);
    if (!row) return NextResponse.json({ ok: false, error: "当前访客还没有可审计的画像。" }, { status: 404 });
    if (!row.profile.knownSkillIds.includes(skillId)) {
      return NextResponse.json({ ok: false, error: "只能为当前已确认的技能提交作品审计。" }, { status: 400 });
    }

    const audit = await auditPublicGithubRepository(body?.githubUrl) as GithubAudit & { reasons: string[]; error?: string };
    const current = row.profile.evidenceLevels[skillId] ?? 1;
    const finalLevel = audit.passed ? Math.max(current, 3) : current;
    const record: ActionEvaluation = {
      actionId,
      deliverableType: "github-repository",
      requiredElements: ["公开 GitHub 仓库", "公开提交历史", "语言占比"],
      confirmedElements: audit.passed ? ["公开 GitHub 仓库", "公开提交历史", "语言占比"] : [],
      ruleHits: audit.reasons,
      artifactTitle: `GitHub 仓库：${audit.owner && audit.repo ? `${audit.owner}/${audit.repo}` : "链接格式待修正"}`,
      artifactLocation: audit.url || undefined,
      suggestedLevel: 3,
      finalLevel,
      overridden: false,
      note: "自动审计仅使用 GitHub 公开 commits 与 languages API；不读取源码、不代表人工核验原创度。",
      evaluatedAt: audit.auditedAt,
      source: "github-api",
      skillId,
      githubAudit: audit,
    };
    const nextProfile: Profile = {
      ...row.profile,
      evidenceLevels: audit.passed ? { ...row.profile.evidenceLevels, [skillId]: finalLevel } : row.profile.evidenceLevels,
      actionEvaluations: { ...(row.profile.actionEvaluations ?? {}), [actionId]: record },
    };
    saveUserProfile({ ...row, profile: nextProfile, updatedAt: "" }, ownerId);
    return NextResponse.json({ ok: true, passed: audit.passed, audit, profile: nextProfile });
  } catch {
    return NextResponse.json({ ok: false, error: "审计请求格式无效。" }, { status: 400 });
  }
}
