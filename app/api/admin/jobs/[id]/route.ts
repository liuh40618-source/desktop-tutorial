import { NextResponse } from "next/server";
import { upsertJob, deleteJob, validateJobInput } from "@/lib/db";

/** 更新岗位（按路径 id 覆盖） */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    // 路径上的 id 优先；若 body 带了不同 id 以路径为准
    const v = validateJobInput({ ...body, id });
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
    upsertJob(v.job);
    return NextResponse.json({ ok: true, job: v.job });
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法的 JSON，或字段缺失" }, { status: 400 });
  }
}

/** 删除岗位 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteJob(id);
  return NextResponse.json({ ok: true, id });
}
