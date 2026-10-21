import { NextRequest, NextResponse } from "next/server";

/**
 * 简易后台鉴权（个人工具场景够用）：
 * - 未配置 ADMIN_TOKEN：本地开发放行；生产环境关闭管理入口
 * - 配置后：/admin 页面与 /api/admin/* 写接口需要 cookie zhitu_admin == ADMIN_TOKEN
 * - 未登录访问页面 → 302 到 /admin/login；直调写接口 → 401
 *
 * 未配置 ADMIN_TOKEN 时的生产行为（访客访问管理入口时按此表现）：
 * - 页面 /admin/* → 302 回首页，访客不会撞到"管理后台暂未启用"的裸错误页
 * - 接口 /api/admin/* → 503 + JSON，仅暴露给直接调用方
 *
 * Next 16 中间件文件约定由 `middleware.ts` 改名为 `proxy.ts`，导出名同步为 proxy。
 */
const TOKEN = process.env.ADMIN_TOKEN;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!TOKEN) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "admin_disabled", message: "请先配置 ADMIN_TOKEN，再启用管理接口。" }, { status: 503 });
    }
    // 页面访问：不展示裸错误文本，直接送回主流程入口
    const home = new URL("/plan", req.url);
    home.searchParams.set("admin", "off");
    return NextResponse.redirect(home);
  }

  const authed = req.cookies.get("zhitu_admin")?.value === TOKEN;
  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/admin")) {
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
