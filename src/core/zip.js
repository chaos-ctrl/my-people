// A tiny ZIP reader: lists entries and extracts stored or deflated files with the standard
// DecompressionStream (browsers and Node 18+). Enough for WhatsApp chat exports; no ZIP64, no encryption.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export const isZip = bytes => bytes.length >= 4 && u32(bytes, 0) === 0x04034b50;

/** Entries of a ZIP file (Uint8Array): [{name, method, size, offset}]. Throws on a damaged file. */
export function zipEntries(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This ZIP file looks damaged.');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('This ZIP file looks damaged.');
    const nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32);
    out.push({
      name: dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      method: u16(bytes, p + 10),
      size: u32(bytes, p + 20),
      usize: u32(bytes, p + 24),
      offset: u32(bytes, p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Bytes of one entry, refusing anything that unpacks to more than `limit` bytes (zip bombs). */
export async function zipRead(bytes, entry, limit = 50 * 1024 * 1024) {
  const tooBig = () => new Error('This file is too big to read.');
  if (entry.usize > limit) throw tooBig();
  const h = entry.offset;
  if (u32(bytes, h) !== 0x04034b50) throw new Error('This ZIP file looks damaged.');
  const start = h + 30 + u16(bytes, h + 26) + u16(bytes, h + 28);
  const data = bytes.subarray(start, start + entry.size);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new Error('This ZIP file uses a compression the app can’t read.');
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); throw tooBig(); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) { out.set(part, o); o += part.length; }
  return out;
}

// ---- writing (for backups) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A ZIP archive (stored, not compressed: the files are small text) from [{name, data}] where data is a
 * string or Uint8Array. `date` (a Date) is the modification time of every entry.
 */
export function makeZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day = (Math.max(0, date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const parts = [], central = [];
  let offset = 0;
  const put = (arr, size, fn) => { const b = new Uint8Array(size); const v = new DataView(b.buffer); fn(v); arr.push(b); return b; };
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    put(parts, 30, v => {
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); // UTF-8 names
      v.setUint16(8, 0, true); v.setUint16(10, time, true); v.setUint16(12, day, true);
      v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
      v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
    });
    parts.push(name, data);
    put(central, 46, v => {
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true);
      v.setUint16(10, 0, true); v.setUint16(12, time, true); v.setUint16(14, day, true);
      v.setUint32(16, crc, true); v.setUint32(20, data.length, true); v.setUint32(24, data.length, true);
      v.setUint16(28, name.length, true); v.setUint32(42, offset, true);
    });
    central.push(name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  put(central, 22, v => {
    v.setUint32(0, 0x06054b50, true); v.setUint16(8, files.length, true); v.setUint16(10, files.length, true);
    v.setUint32(12, cdSize, true); v.setUint32(16, offset, true);
  });
  const all = [...parts, ...central];
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}
