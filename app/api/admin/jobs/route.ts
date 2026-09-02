import { NextResponse } from "next/server";
import { getKnowledgeBase, getJobById, upsertJob, validateJobInput } from "@/lib/db";

/** 列出全部岗位（含完整结构），供后台表格与表单使用 */
export async function GET() {
  return NextResponse.json(getKnowledgeBase().jobs);
}

/** 新建岗位：id 已存在则返回 409，请改用 PUT 更新 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const v = validateJobInput(body);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
    if (getJobById(v.job.id)) {
      return NextResponse.json({ ok: false, error: `岗位 id 已存在: ${v.job.id}（请用 PUT 更新）` }, { status: 409 });
    }
    upsertJob(v.job);
    return NextResponse.json({ ok: true, job: v.job });
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
}
