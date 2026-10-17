/**
 * 零依赖 ZIP 写入器（store + deflate）。
 *
 * 只覆盖本项目提交包所需的最小能力：普通文件、UTF-8 文件名、< 4GB、< 65535 条目。
 * 不引入 archiver / jszip 等依赖，与项目「零依赖、可离线复现」的既有取向一致。
 *
 * 格式依据 PKWARE APPNOTE：本地文件头 0x04034b50 / 中央目录 0x02014b50 / EOCD 0x06054b50。
 */
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function dosStamp(date) {
  const time =
    ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) &
    0xffff;
  const day =
    (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) &
    0xffff;
  return { time, day };
}

/**
 * @param {{ name: string, data: Buffer }[]} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  if (entries.length === 0) throw new Error("createZip: entries 为空");
  if (entries.length > 0xffff) throw new Error("createZip: 条目数超过 65535，需 Zip64");

  const { time, day } = dosStamp(new Date());
  const localChunks = [];
  const centralChunks = [];
  let localSize = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const raw = entry.data;
    const crc = crc32(raw);

    const deflated = deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // bit 11 = 文件名为 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    localChunks.push(local, nameBytes, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(day, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk number start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(localSize, 42); // 本地头偏移

    centralChunks.push(cd, nameBytes);

    localSize += local.length + nameBytes.length + body.length;
  }

  const centralBuf = Buffer.concat(centralChunks);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localSize, 16); // 中央目录偏移 = 全部本地记录长度
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}
