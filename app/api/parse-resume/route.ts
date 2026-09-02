import { NextResponse } from "next/server";

/**
 * 简历解析（服务端，纯本地，零 LLM）
 *
 * 只做一件事：把上传的 PDF / DOCX / TXT / MD 提取成纯文本，供前端做技能识别。
 * 不调用任何大模型、不写库、不落盘——文本只在内存中流转，用完即弃。
 */

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_CHARS = 8000; // 截取上限：识别技能只需关键词，长简历截断即可

function normalize(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

async function extractPdf(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text ?? "");
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return String(value ?? "");
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ message: "没有收到文件" }, { status: 400 });
    }

    const f = file as File;
    const name = f.name || "未命名文件";
    const ext = (name.split(".").pop() || "").toLowerCase();

    if (!["pdf", "docx", "txt", "md", "markdown"].includes(ext)) {
      return NextResponse.json({ message: "仅支持 PDF、DOCX、TXT、MD 格式" }, { status: 400 });
    }

    if (f.size > MAX_BYTES) {
      return NextResponse.json({ message: "文件超过 5MB，请压缩后再上传" }, { status: 400 });
    }

    const buf = Buffer.from(await f.arrayBuffer());
    let raw = "";

    if (ext === "pdf") raw = await extractPdf(buf);
    else if (ext === "docx") raw = await extractDocx(buf);
    else raw = buf.toString("utf-8");

    const text = normalize(raw);

    if (!text) {
      return NextResponse.json(
        { message: "没能从文件中提取到文字，可能是扫描件或图片型 PDF" },
        { status: 400 }
      );
    }

    return NextResponse.json({ text, name });
  } catch (e: any) {
    return NextResponse.json({ message: e?.message || "文件解析失败" }, { status: 500 });
  }
}
