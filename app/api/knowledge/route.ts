import { NextResponse } from "next/server";
import { getKnowledgeBase } from "@/lib/db";

/**
 * 内部数据接口：返回整库岗位 / 技能 / 方向知识库。
 * 纯数据、零 LLM、零外部调用；前端拿到后在本地理算匹配、差距与路径。
 */
export async function GET() {
  const kb = getKnowledgeBase();
  return NextResponse.json(kb);
}
