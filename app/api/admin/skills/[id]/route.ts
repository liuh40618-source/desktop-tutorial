import { NextResponse } from "next/server";
import { getSkillById, upsertSkill, deleteSkill, validateSkillInput } from "@/lib/db";

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

/** 删除技能：若仍被岗位引用，返回引用列表并拒绝删除。 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSkillById(id)) return NextResponse.json({ ok: false, error: `技能不存在: ${id}` }, { status: 404 });
  const result = deleteSkill(id);
  if (!result.deleted) {
    return NextResponse.json(
      {
        ok: false,
        error: `技能「${id}」仍被 ${result.references.length} 处岗位引用，请先从岗位 core/plus 中移除。`,
        references: result.references,
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, id });
}
