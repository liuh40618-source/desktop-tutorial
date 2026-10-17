/**
 * 提交包构建的单元测试。
 *
 * 覆盖 scripts/submit/lib/zip.mjs 产出的字节结构，不依赖任何第三方解压库：
 * 自行解析 EOCD 与中央目录，再按压缩方法还原内容并比对。
 * 另用 CRC-32 已知向量独立校验校验和实现是否正确。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { createZip } from "../scripts/submit/lib/zip.mjs";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error("未找到 EOCD 记录");
}

function readEntries(buf) {
  const eocd = findEocd(buf);
  assert.equal(buf.readUInt16LE(eocd + 4), 0, "单卷 zip：磁盘号应为 0");
  assert.equal(buf.readUInt16LE(eocd + 8), buf.readUInt16LE(eocd + 10), "条目数应一致");

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  assert.equal(cdOffset + cdSize, eocd, "中央目录应紧邻 EOCD");

  const entries = [];
  let off = cdOffset;
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(off), SIG_CENTRAL, "中央目录头签名");
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    const compSize = buf.readUInt32LE(off + 20);
    const rawSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    entries.push({ name, flags, method, crc, compSize, rawSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extract(buf, entry) {
  const lo = entry.localOff;
  assert.equal(buf.readUInt32LE(lo), SIG_LOCAL, "本地文件头签名");
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const body = buf.subarray(start, start + entry.compSize);
  return entry.method === 8 ? inflateRawSync(body) : Buffer.from(body);
}

test("空条目列表应直接抛错", () => {
  assert.throws(() => createZip([]), /entries 为空/);
});

test("CRC-32 与已知向量一致（'123456789' -> 0xCBF43926）", () => {
  const buf = createZip([{ name: "a.txt", data: Buffer.from("123456789", "utf8") }]);
  const [entry] = readEntries(buf);
  assert.equal(entry.crc >>> 0, 0xcbf43926);
});

test("中央目录与本地头可正确解析，内容可原样还原", () => {
  const payload = Buffer.from("职途 · 提交包往返测试\n".repeat(20), "utf8");
  const buf = createZip([{ name: "doc-说明书.md", data: payload }]);
  const entries = readEntries(buf);
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.name, "doc-说明书.md");
  assert.equal(entry.rawSize, payload.length);
  assert.deepEqual(extract(buf, entry), payload);
});

test("中文文件名置位 UTF-8 标志（通用目的位 11）", () => {
  const buf = createZip([{ name: "demo-演示视频.mp4", data: Buffer.from("x") }]);
  const [entry] = readEntries(buf);
  assert.equal(entry.flags & 0x0800, 0x0800, "应置位 UTF-8 标志");
  assert.equal(entry.name, "demo-演示视频.mp4");
});

test("多条目顺序与偏移正确，互不覆盖", () => {
  const files = [
    { name: "提交信息.md", data: Buffer.from("# 提交信息\n", "utf8") },
    { name: "doc-a.pdf", data: Buffer.from("%PDF-1.4 假数据", "utf8") },
    { name: "demo-a.mp4", data: Buffer.from("假视频数据", "utf8") },
  ];
  const buf = createZip(files);
  const entries = readEntries(buf);
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.name),
    files.map((f) => f.name),
  );
  entries.forEach((entry, i) => {
    assert.deepEqual(extract(buf, entry), files[i].data, `第 ${i} 个条目内容应一致`);
  });
});

test("小体积且不可压缩的数据回退为 store（方法 0）", () => {
  const buf = createZip([{ name: "demo-tiny.mp4", data: Buffer.from([0x00, 0x01, 0x02, 0x03]) }]);
  const [entry] = readEntries(buf);
  assert.equal(entry.method, 0, "压缩无收益时应使用 store");
  assert.equal(entry.compSize, entry.rawSize);
  assert.deepEqual(extract(buf, entry), Buffer.from([0x00, 0x01, 0x02, 0x03]));
});

test("文本数据走 deflate（方法 8）且体积确有下降", () => {
  const data = Buffer.from("重复内容重复内容重复内容重复内容".repeat(50), "utf8");
  const buf = createZip([{ name: "doc-long.md", data }]);
  const [entry] = readEntries(buf);
  assert.equal(entry.method, 8);
  assert.ok(entry.compSize < entry.rawSize, "压缩后应更小");
  assert.deepEqual(extract(buf, entry), data);
});
