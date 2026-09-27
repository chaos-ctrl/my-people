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
