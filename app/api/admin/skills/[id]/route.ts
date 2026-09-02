import { NextResponse } from "next/server";
import { upsertSkill, deleteSkill, validateSkillInput } from "@/lib/db";

/** 更新技能（按路径 id 覆盖） */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const v = validateSkillInput({ ...body, id });
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
    upsertSkill(v.skill);
    return NextResponse.json({ ok: true, skill: v.skill });
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法的 JSON，或字段缺失" }, { status: 400 });
  }
}

/** 删除技能 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteSkill(id);
  return NextResponse.json({ ok: true, id });
}
