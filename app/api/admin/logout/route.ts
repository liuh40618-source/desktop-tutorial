import { NextResponse } from "next/server";

/** 后台退出：清除登录 cookie */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("zhitu_admin", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
