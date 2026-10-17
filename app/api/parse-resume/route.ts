import { NextResponse } from "next/server";

/**
 * 简历解析（应用服务端进程内处理）
 *
 * 只做一件事：把上传的 PDF / DOCX / TXT / MD 提取成纯文本，供前端做技能识别。
 * 在应用所在的 Node.js 进程内提取文字：不调用外部服务、不写应用数据库或持久文件。
 * 远程部署时，上传内容会到达部署服务器；运行环境或反向代理可能有独立的数据处理策略。
 */

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_CHARS = 8000; // 截取上限：识别技能只需关键词，长简历截断即可

/**
 * 可预期的「输入本身有问题」类错误（加密 / 损坏 / 无文字），
 * 用 4xx 返回给用户一个能照着改的提示；其余异常走 500 兜底。
 */
class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

function errText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/* ---------------- 文本解码与去噪 ---------------- */

/** 解码 TXT / MD：优先 UTF-8，出现乱码占位符再兜底试 GBK */
function decodeText(buf: Buffer): string {
  const utf8 = buf.toString("utf-8").replace(/^\uFEFF/, ""); // 去掉 UTF-8 BOM
  if (!utf8.includes("\uFFFD")) return utf8; // 没有乱码占位符，说明本来就是 UTF-8

  try {
    const gbk = new TextDecoder("gbk").decode(buf).replace(/^\uFEFF/, "");
    if (!gbk.includes("\uFFFD")) return gbk; // GBK 无乱码才采纳
  } catch {
    /* 当前运行时若缺少 gbk 支持，保留 UTF-8 结果，交给下方空文本兜底 */
  }
  return utf8;
}

/** 是否有可读字符（含中日韩等任意字母与数字）；纯符号 / 空白视作无内容 */
function hasReadableChar(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** 单独成行且对技能识别无意义的噪声（页码 / 页脚 / 符号装饰 / 简历标题） */
function isNoiseLine(line: string): boolean {
  if (/^\s*$/.test(line)) return true;
  // 页码 / 分页标记：第 1 页、第 1 页 / 共 2 页、page 1 of 2、裸页码
  if (/^(第\s*\d+\s*页(\s*[/／]\s*共\s*\d+\s*页)?|共\s*\d+\s*页)$/.test(line)) return true;
  if (/^page\s*\d+(\s*(of|[/])\s*\d+)?$/i.test(line)) return true;
  if (/^[-—–.]?\s*\d{1,3}\s*[-—–.]?$/.test(line)) return true;
  if (/^(个人简历|简历|resume|curriculum\s*vitae|cv)$/i.test(line)) return true;
  // 邮箱 / 电话被剥掉后剩下的联系方式标签壳，如「电话：」「Email:」
  if (/^(?:电话|手机(?:号)?|邮箱|电子邮件?|e-?mail|微信|wechat|qq|联系人?|联系|地址|住址)\s*[:：]?$/i.test(line)) return true;
  // 只有符号 / 空白（PDF 常见页眉装饰、分隔符行）
  if (/^[\s\p{P}\p{S}\p{C}]+$/u.test(line)) return true;
  return false;
}

/**
 * 正文去噪：规范化空白、剥掉简历里常见的页眉页脚与联系方式噪声。
 * 邮箱、电话、链接对技能识别无帮助，但 "github.com" 之类域名是有效的技能信号，
 * 所以链接只去掉协议头、保留可读部分，避免误删关键词。
 */
function normalize(raw: string): string {
  const cleaned = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000+/g, " ") // PDF 提取时混入的空字节
    .replace(/\u00a0/g, " ") // 不间断空格
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, " ") // 邮箱
    .replace(/(?<!\d)1[3-9]\d(?:[ -]?\d{4}){2}(?!\d)/g, " ") // 大陆手机号
    .replace(/\bhttps?:\/\//gi, "") // 只去链接协议头
    .replace(/\bwww\./gi, "");

  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !isNoiseLine(l));

  return lines
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, MAX_CHARS);
}

/* ---------------- PDF / DOCX 抽取与报错细分 ---------------- */

async function extractPdf(buf: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : String(text ?? "");
  } catch (e) {
    const s = errText(e);
    if (/(password|encrypt|incorrect|no password)/i.test(s)) {
      throw new ParseError("PDF 已加密或受密码保护，无法解析。请先取消密码、另存一份普通 PDF 再上传。");
    }
    if (/(invalid pdf|corrupt|damaged|trailer|eof|unexpected|parse error)/i.test(s)) {
      throw new ParseError("这份 PDF 看起来已损坏或不完整，请用源文件重新导出后再试。");
    }
    throw e;
  }
}

async function extractDocx(buf: Buffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return String(value ?? "");
  } catch (e) {
    const s = errText(e);
    if (/(encrypt|password)/i.test(s)) {
      throw new ParseError("DOCX 已加密，无法解析。请去掉打开密码后再上传。");
    }
    if (/(central directory|corrupt|invalid|not a zip|unzip|eof|not found)/i.test(s)) {
      throw new ParseError("这份 DOCX 无法读取：文件可能已损坏，或其实不是 Word 文档。请另存一份 .docx 再试。");
    }
    throw e;
  }
}

/* ---------------- 入口 ---------------- */

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
    else raw = decodeText(buf); // txt / md / markdown：UTF-8 失败兜底 GBK

    const text = normalize(raw);

    if (!text || !hasReadableChar(text)) {
      // 空文本 = 扫描件/图片型 PDF；有符号无文字 = 模板残留。两种都提示换「可复制文字」的文件。
      return NextResponse.json(
        {
          message: text
            ? "提取到的只有符号或标点，没有可识别的文字。请上传带文字层的 PDF，或直接用 TXT / MD。"
            : "没能从文件中提取到文字：可能是扫描件 / 图片型 PDF，或文件本身就是空的。",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ text, name });
  } catch (e) {
    if (e instanceof ParseError) {
      return NextResponse.json({ message: e.message }, { status: 400 });
    }
    // 解析库自身异常：把细节留给服务端日志，对用户只给可行动的提示
    console.error("[parse-resume] unexpected error:", errText(e));
    return NextResponse.json(
      { message: "解析过程中出了点意外，请换一份文件或稍后再试。" },
      { status: 500 }
    );
  }
}
