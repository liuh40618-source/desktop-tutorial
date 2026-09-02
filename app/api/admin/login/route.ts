import { NextResponse } from "next/server";

/**
 * 后台登录：输入与 ADMIN_TOKEN 一致 → 种下 httpOnly cookie（7 天）。
 * 未配置 ADMIN_TOKEN 时返回 ok（middleware 已放行，登录页不会出现）。
 */
export async function POST(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return NextResponse.json({ ok: true });

  let input = "";
  try {
    const body = (await req.json()) as { token?: unknown };
    input = typeof body?.token === "string" ? body.token : "";
  } catch {
    /* 空 body 视为未提供 */
  }

  if (!input || input !== token) {
    return NextResponse.json({ ok: false, error: "口令不正确" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("zhitu_admin", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    // 生产走 HTTPS（部署文档强制）；本地 http 开发环境不设 secure
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
