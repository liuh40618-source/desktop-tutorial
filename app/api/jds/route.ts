import { NextResponse } from "next/server";
import { listJds, addJd, deleteJd, type JdRow } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(listJds());
}

export async function POST(req: Request) {
  try {
    const jd = (await req.json()) as Partial<JdRow>;
    if (!jd || !jd.id) {
      return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
    }
    addJd({
      id: String(jd.id),
      title: String(jd.title ?? "").slice(0, 120),
      raw: String(jd.raw ?? "").slice(0, 20000),
      skills: Array.isArray(jd.skills) ? jd.skills.map(String) : [],
      createdAt: Number(jd.createdAt) || Date.now(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) deleteJd(id);
  return NextResponse.json({ ok: true });
}
