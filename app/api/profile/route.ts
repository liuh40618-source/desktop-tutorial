import { NextResponse } from "next/server";
import {
  getUserProfile,
  saveUserProfile,
  deleteUserProfile,
  type ProfileRow,
} from "@/lib/db";
import { readGuestOwner } from "@/lib/session";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "访客会话已失效，请刷新页面后重试。" }, { status: 401 });
}

export async function GET(req: Request) {
  const ownerId = readGuestOwner(req);
  if (!ownerId) return unauthorized();
  return NextResponse.json(getUserProfile(ownerId) ?? null, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const ownerId = readGuestOwner(req);
  if (!ownerId) return unauthorized();
  try {
    const body = await req.json();
    const row: ProfileRow = {
      id: ownerId,
      name: "",
      step: body.step ?? 0,
      started: !!body.started,
      profile: body.profile ?? {},
      selectedJobId: body.selectedJobId ?? "",
      doneSkills: body.doneSkills ?? [],
      updatedAt: "",
    };
    saveUserProfile(row, ownerId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const ownerId = readGuestOwner(req);
  if (!ownerId) return unauthorized();
  deleteUserProfile(ownerId);
  return NextResponse.json({ ok: true });
}
