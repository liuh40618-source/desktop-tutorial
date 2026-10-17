import { NextResponse } from "next/server";
import { getKnowledgeBase, listJds, addJd, deleteJd, type JdRow } from "@/lib/db";
import { MAX_JD_TITLE_CHARS, MAX_JD_CHARS, normalizeJdText } from "@/lib/jd";
import { readGuestOwner } from "@/lib/session";

export const runtime = "nodejs";

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  const ownerId = readGuestOwner(req);
  if (!ownerId) return jsonError("访客会话已失效，请刷新页面后重试。", 401);
  return NextResponse.json(listJds(ownerId), { headers: { "Cache-Control": "no-store" } });
}

/** 保存已经由 /api/jds/parse 解析、且经过用户确认的 JD。 */
export async function POST(req: Request) {
  const ownerId = readGuestOwner(req);
  if (!ownerId) return jsonError("访客会话已失效，请刷新页面后重试。", 401);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("请求体不是合法的 JSON，请重试。", 400);
  }
  if (!body || typeof body !== "object") return jsonError("请求体必须是对象。", 400);

  const input = body as Partial<JdRow>;
  const id = String(input.id ?? "").trim();
  const rawInput = String(input.raw ?? "").trim();
  const raw = normalizeJdText(rawInput).text;
  const title = String(input.title ?? "").trim();
  if (!id) return jsonError("JD id 不能为空，请重新解析。", 400);
  if (!raw) return jsonError("JD 正文不能为空。", 400);
  if (rawInput.length > MAX_JD_CHARS) return jsonError(`JD 正文不能超过 ${MAX_JD_CHARS} 个字符。`, 413);
  if (title.length > MAX_JD_TITLE_CHARS) return jsonError(`岗位名称不能超过 ${MAX_JD_TITLE_CHARS} 个字符。`, 400);
  if (!Array.isArray(input.skills)) return jsonError("缺少已确认的技能列表，请重新解析。", 400);

  const knownSkillIds = new Set(getKnowledgeBase().skills.map((skill) => skill.id));
  const skills = Array.from(new Set(input.skills.map(String).map((skill) => skill.trim()).filter(Boolean)));
  const unknown = skills.filter((skill) => !knownSkillIds.has(skill));
  if (unknown.length) return jsonError(`技能不存在或已被删除：${unknown.join("、")}`, 400);

  const createdAt = Number(input.createdAt);
  const jd: JdRow = {
    id,
    title: (title || "未命名 JD").slice(0, MAX_JD_TITLE_CHARS),
    raw,
    skills,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
  };
  if (!addJd(jd, ownerId)) return jsonError("JD id 冲突，请重新解析后保存。", 409);
  return NextResponse.json({ ok: true, jd });
}

export async function DELETE(req: Request) {
  const ownerId = readGuestOwner(req);
  if (!ownerId) return jsonError("访客会话已失效，请刷新页面后重试。", 401);
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return jsonError("缺少要删除的 JD id。", 400);
  if (!deleteJd(id, ownerId)) return jsonError("这条 JD 不存在或已被删除。", 404);
  return NextResponse.json({ ok: true, id });
}
