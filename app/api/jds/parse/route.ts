import { NextResponse } from "next/server";
import { getKnowledgeBase, insertRawJdObservation, isJdObservationRecordingEnabled } from "@/lib/db";
import { MAX_JD_TITLE_CHARS, normalizeJdText, parseJdText } from "@/lib/jd";

export const runtime = "nodejs";

const MAX_RAW_CHARS = 30000;

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * 解析真实 JD：清洗文本 + 规则识别技能。
 * 解析结果只返回给前端，用户确认后再通过 /api/jds 持久化。
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("请求体不是合法的 JSON，请重试。", 400);
  }

  if (!body || typeof body !== "object") return error("请求体必须是对象。", 400);
  const input = body as { title?: unknown; raw?: unknown };
  const raw = typeof input.raw === "string" ? input.raw : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";

  if (!raw.trim()) return error("请先粘贴 JD 正文。", 400);
  if (raw.length > MAX_RAW_CHARS) {
    return error(`JD 原文不能超过 ${MAX_RAW_CHARS} 个字符，请删减后再试。`, 413);
  }

  const { text, truncated } = normalizeJdText(raw);
  if (!text || !/[\p{L}\p{N}]/u.test(text)) {
    return error("JD 中没有可识别的文字，请检查粘贴内容。", 400);
  }

  const kb = getKnowledgeBase();
  const parsed = parseJdText(text, kb.skills);
  const createdAt = Date.now();
  const safeTitle = (title || text.split("\n").find(Boolean) || "未命名 JD").slice(0, MAX_JD_TITLE_CHARS);

  // P1-1：解析后记录一条观察（text_hash 去重）。请求路径上只有一次 INSERT、无聚合查询；
  // 记录失败绝不影响解析返回（fire-and-forget，try/catch 吞掉并记日志）。
  let observationRecorded = false;
  try {
    if (isJdObservationRecordingEnabled()) {
      observationRecorded = insertRawJdObservation({
        jobId: null,
        rawText: text,
        parsedSkills: parsed.skills,
        source: "user_paste",
        createdAt,
      });
    }
  } catch (recordError) {
    console.error("[api/jds/parse] 记录 JD 观察失败（不影响解析返回）", recordError);
  }

  return NextResponse.json({
    ok: true,
    id: `jd-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    title: safeTitle,
    raw: parsed.normalized,
    skills: parsed.skills,
    skillSources: parsed.skillSources,
    createdAt,
    observationRecorded,
    meta: {
      method: "rule",
      truncated: truncated || parsed.truncated,
      normalizedChars: text.length,
    },
  });
}
