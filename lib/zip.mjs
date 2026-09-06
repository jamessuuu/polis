/**
 * A ZIP reader and writer with no dependencies, usable unchanged in the
 * browser and in Node.
 *
 * Why this exists rather than a package. The import path has to run entirely
 * inside the visitor's tab: their agent charters are private intellectual
 * property and this project's whole claim is that they never leave the
 * machine. A dependency would be a second thing to trust and a second thing
 * to ship. The two pieces of ZIP that are genuinely hard (deflate and
 * inflate) are already in every target runtime as `CompressionStream` and
 * `DecompressionStream`, so what is left is the container format: a few
 * fixed-width records, a CRC and a directory. That is small enough to write,
 * read and test here.
 *
 * Availability, checked rather than assumed: `DecompressionStream` and
 * `CompressionStream` are present in Node 18+ (this repo requires 22) and in
 * Chrome 80+/103+, Firefox 113+ and Safari 16.4+. When `CompressionStream` is
 * missing the writer stores entries uncompressed, which is still a valid ZIP
 * every extractor opens, so a missing API costs bytes and never correctness.
 *
 * What is deliberately NOT supported, stated instead of silently mishandled:
 *
 *   - ZIP64. Archives with more than 65535 entries, or any entry or archive
 *     over 4 GB, are rejected with a named error. A skills bundle is text.
 *   - Encryption, multi-disk archives, and compression methods other than
 *     store (0) and deflate (8). Any other method is reported per entry so a
 *     caller can say which file it could not read, rather than dropping it.
 *   - Symlinks and file modes. Every written entry is a plain file.
 *
 * Paths are normalised on read: backslashes become forward slashes, and any
 * entry that escapes the archive root (absolute, or containing a `..`
 * segment) is refused. A zip is untrusted input even when the visitor chose
 * it themselves.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIG = 0x07064b50;

/** Everything this module refuses to guess about. */
export class ZipError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ZipError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// CRC32
// ---------------------------------------------------------------------------

let CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

/** Standard PKZIP CRC-32 over a byte array. */
export function crc32(bytes) {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/**
 * Normalise an archive member name, or return null when it must be refused.
 *
 * Zip slip is the reason this is not just a string. An entry named
 * `../../.bashrc` extracted naively writes outside the target directory, and
 * although this module never writes to disk itself, its output is handed to
 * code that might. Refusing here means one check instead of one per caller.
 */
export function safeEntryName(raw) {
  const name = String(raw ?? '').replace(/\\/g, '/');
  if (!name || name.startsWith('/') || /^[a-zA-Z]:\//.test(name)) return null;
  const parts = name.split('/');
  if (parts.some((p) => p === '..')) return null;
  if (name.includes('\0')) return null;
  return name;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function findEocd(view, length) {
  // The end-of-central-directory record is last, but a trailing comment of up
  // to 65535 bytes may follow it, so it has to be searched for backwards.
  const max = Math.min(length, 22 + 0xffff);
  for (let i = length - 22; i >= length - max; i--) {
    if (i < 0) break;
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new ZipError('this runtime has no DecompressionStream, so deflated entries cannot be read', 'no-inflate');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Read a ZIP archive into entries.
 *
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {Promise<{entries: {name: string, bytes: Uint8Array}[], skipped: {name: string, reason: string}[]}>}
 *
 * Entries this reader cannot handle are collected in `skipped` rather than
 * thrown, because one odd member in an archive of two hundred charters must
 * not cost the visitor the other one hundred and ninety nine. Structural
 * damage to the archive itself is still an error: there is nothing to salvage
 * and pretending otherwise would report an empty ecosystem as a real one.
 */
export async function readZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 22) throw new ZipError('too small to be a zip archive', 'truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEocd(view, bytes.length);
  if (eocd < 0) throw new ZipError('no end-of-central-directory record found', 'not-a-zip');

  // ZIP64 announces itself with a locator immediately before the EOCD.
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_EOCD_LOCATOR_SIG) {
    throw new ZipError('zip64 archives are not supported', 'zip64');
  }

  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('zip64 archives are not supported', 'zip64');
  }
  if (cdOffset + cdSize > bytes.length) throw new ZipError('central directory runs past the end of the file', 'truncated');

  const entries = [];
  const skipped = [];
  let p = cdOffset;

  for (let i = 0; i < total; i++) {
    if (p + 46 > bytes.length) throw new ZipError('central directory entry is truncated', 'truncated');
    if (view.getUint32(p, true) !== CENTRAL_SIG) throw new ZipError('central directory entry has a bad signature', 'corrupt');

    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    // Sizes are read from the CENTRAL directory, never from the local header.
    // An entry written with a streaming data descriptor (general purpose flag
    // bit 3) carries zeroes in its local header, and a reader that trusts
    // those returns an empty file with no error at all.
    const csize = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const rawName = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (rawName.endsWith('/')) continue; // a directory entry carries no data

    const name = safeEntryName(rawName);
    if (name === null) {
      skipped.push({ name: rawName, reason: 'unsafe path' });
      continue;
    }
    if (method !== 0 && method !== 8) {
      skipped.push({ name, reason: `unsupported compression method ${method}` });
      continue;
    }
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIG) {
      skipped.push({ name, reason: 'local header missing or misplaced' });
      continue;
    }

    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    if (start + csize > bytes.length) {
      skipped.push({ name, reason: 'entry data runs past the end of the file' });
      continue;
    }

    const raw = bytes.subarray(start, start + csize);
    let out;
    try {
      out = method === 0 ? raw.slice() : await inflateRaw(raw);
    } catch {
      skipped.push({ name, reason: 'could not decompress' });
      continue;
    }
    if (out.length !== usize) {
      skipped.push({ name, reason: 'decompressed size does not match the directory' });
      continue;
    }
    if (crc32(out) !== crc) {
      skipped.push({ name, reason: 'checksum mismatch' });
      continue;
    }
    entries.push({ name, bytes: out });
  }

  return { entries, skipped };
}

/** Read a zip and decode every entry as UTF-8 text. */
export async function readZipAsText(input) {
  const { entries, skipped } = await readZip(input);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return { files: entries.map((e) => ({ path: e.name, text: decoder.decode(e.bytes) })), skipped };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * DOS date and time, fixed by default.
 *
 * Reproducible output is worth more here than a real clock: two exports of
 * the same bundle should be byte-identical so a difference in the file means
 * a difference in the content. 1980-01-01 00:00 is the earliest value the DOS
 * format can express, which makes it obviously a placeholder rather than a
 * plausible-looking lie about when the file was made.
 */
function dosStamp(date) {
  if (!date) return { time: 0, date: 33 }; // 1980-01-01 00:00:00
  const d = date instanceof Date ? date : new Date(date);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Build a ZIP archive from `{ path, text }` or `{ path, bytes }` files.
 *
 * @param {{path: string, text?: string, bytes?: Uint8Array}[]} files
 * @param {{compress?: boolean, date?: Date|null}} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function writeZip(files, opts = {}) {
  const compress = opts.compress !== false;
  const stamp = dosStamp(opts.date ?? null);
  const encoder = new TextEncoder();

  if (files.length > 0xffff) throw new ZipError('more than 65535 entries needs zip64', 'zip64');

  const prepared = [];
  const seen = new Set();
  for (const file of files) {
    const name = safeEntryName(file.path);
    if (name === null) throw new ZipError(`refusing to write an unsafe entry name: ${file.path}`, 'unsafe-path');
    if (seen.has(name)) throw new ZipError(`duplicate entry name: ${name}`, 'duplicate');
    seen.add(name);

    const data = file.bytes ?? encoder.encode(file.text ?? '');
    if (data.length > 0xffffffff) throw new ZipError(`entry is too large for zip32: ${name}`, 'zip64');

    let method = 0;
    let payload = data;
    if (compress && data.length > 64) {
      const deflated = await deflateRaw(data);
      // Only when it actually helps. Deflate can grow already-dense bytes, and
      // a "compressed" entry that is larger than the original is a worse file
      // for no reason.
      if (deflated && deflated.length < data.length) {
        method = 8;
        payload = deflated;
      }
    }
    prepared.push({ name: encoder.encode(name), method, crc: crc32(data), csize: payload.length, usize: data.length, payload });
  }

  let localSize = 0;
  let centralSize = 0;
  for (const e of prepared) {
    localSize += 30 + e.name.length + e.csize;
    centralSize += 46 + e.name.length;
  }
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let p = 0;
  const offsets = [];

  for (const e of prepared) {
    offsets.push(p);
    view.setUint32(p, LOCAL_SIG, true);
    view.setUint16(p + 4, 20, true);        // version needed
    view.setUint16(p + 6, 0x0800, true);    // flag: names are UTF-8
    view.setUint16(p + 8, e.method, true);
    view.setUint16(p + 10, stamp.time, true);
    view.setUint16(p + 12, stamp.date, true);
    view.setUint32(p + 14, e.crc, true);
    view.setUint32(p + 18, e.csize, true);
    view.setUint32(p + 22, e.usize, true);
    view.setUint16(p + 26, e.name.length, true);
    view.setUint16(p + 28, 0, true);        // no extra field
    p += 30;
    out.set(e.name, p);
    p += e.name.length;
    out.set(e.payload, p);
    p += e.csize;
  }

  const cdStart = p;
  for (let i = 0; i < prepared.length; i++) {
    const e = prepared[i];
    view.setUint32(p, CENTRAL_SIG, true);
    view.setUint16(p + 4, 20, true);        // version made by
    view.setUint16(p + 6, 20, true);        // version needed
    view.setUint16(p + 8, 0x0800, true);
    view.setUint16(p + 10, e.method, true);
    view.setUint16(p + 12, stamp.time, true);
    view.setUint16(p + 14, stamp.date, true);
    view.setUint32(p + 16, e.crc, true);
    view.setUint32(p + 20, e.csize, true);
    view.setUint32(p + 24, e.usize, true);
    view.setUint16(p + 28, e.name.length, true);
    view.setUint16(p + 30, 0, true);        // extra
    view.setUint16(p + 32, 0, true);        // comment
    view.setUint16(p + 34, 0, true);        // disk number start
    view.setUint16(p + 36, 0, true);        // internal attributes
    view.setUint32(p + 38, 0, true);        // external attributes
    view.setUint32(p + 42, offsets[i], true);
    p += 46;
    out.set(e.name, p);
    p += e.name.length;
  }

  view.setUint32(p, EOCD_SIG, true);
  view.setUint16(p + 4, 0, true);
  view.setUint16(p + 6, 0, true);
  view.setUint16(p + 8, prepared.length, true);
  view.setUint16(p + 10, prepared.length, true);
  view.setUint32(p + 12, p - cdStart, true);
  view.setUint32(p + 16, cdStart, true);
  view.setUint16(p + 20, 0, true);

  return out;
}
