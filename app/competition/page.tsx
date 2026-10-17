import { redirect } from "next/navigation";

/**
 * 参赛说明页（/competition）
 *
 * 历史文档（README / COMPETITION-ITERATION / NEWTOUCH）一直引用本路径，
 * 但页面文件此前缺失，形成断链。现统一收敛到提交中心 /submit，
 * 由该页同时承担「参赛说明」与「提交核对」两项职责。
 */
export default function CompetitionPage() {
  redirect("/submit");
}
