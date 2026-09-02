import { NextRequest, NextResponse } from "next/server";

/**
 * 简易后台鉴权（个人工具场景够用）：
 * - 未配置 ADMIN_TOKEN（本地开发）→ 全部放行，无摩擦
 * - 配置后：/admin 页面与 /api/admin/* 写接口需要 cookie zhitu_admin == ADMIN_TOKEN
 * - 未登录访问页面 → 302 到 /admin/login；直调写接口 → 401
 */
const TOKEN = process.env.ADMIN_TOKEN;

export function middleware(req: NextRequest) {
  if (!TOKEN) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const authed = req.cookies.get("zhitu_admin")?.value === TOKEN;
  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/admin")) {
    // 登录/登出入口本身不要求已认证
    if (pathname === "/api/admin/login" || pathname === "/api/admin/logout") {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") return NextResponse.next();
    const url = new URL("/admin/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
