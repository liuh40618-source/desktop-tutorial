import { NextResponse } from "next/server";
import { getKnowledgeBase, getSkillById, upsertSkill, validateSkillInput } from "@/lib/db";

/** 列出全部技能，供后台表格与表单使用 */
export async function GET() {
  return NextResponse.json(getKnowledgeBase().skills);
}

/** 新建技能：id 已存在则返回 409，请改用 PUT 更新 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const v = validateSkillInput(body);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
    if (getSkillById(v.skill.id)) {
      return NextResponse.json({ ok: false, error: `技能 id 已存在: ${v.skill.id}（请用 PUT 更新）` }, { status: 409 });
    }
    upsertSkill(v.skill);
    return NextResponse.json({ ok: true, skill: v.skill });
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法的 JSON，或字段缺失" }, { status: 400 });
  }
}
