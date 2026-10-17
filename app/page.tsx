import { redirect } from "next/navigation";

/**
 * 根路径只做重定向：主流程已迁到 /plan（三章节职业试选）。
 *
 * 之前 app/page.tsx 承载主界面，主组件搬到 app/plan/page.tsx 后没有补根路由，
 * 导致直接访问 localhost:4000 返回 404。这里补回，保持旧书签和口述地址可用。
 */
export default function RootPage() {
  redirect("/plan");
}
