import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

// The woff2 table directory names its known tags by index: cmap is 0, glyf
// 10 and loca 11. Tag 63 spells its own four letters.
const CMAP = 0;
const OWN_TAG = 63;
const GLYF_OR_LOCA = new Set([10, 11]);

function base128(buf: Buffer, at: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[at + i] ?? 0;
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return [value, at + i + 1];
  }
  throw new Error('bad UIntBase128');
}

// Where cmap sits in the decompressed tables, and where those tables start.
function directory(buf: Buffer) {
  let at = 48;
  let offset = 0;
  let cmap: { offset: number; length: number } | undefined;
  for (let i = 0; i < buf.readUInt16BE(12); i++) {
    const flags = buf[at++] ?? 0;
    const known = flags & 0x3f;
    if (known === OWN_TAG) at += 4;
    let length: number;
    [length, at] = base128(buf, at);
    // glyf and loca are transformed at version 0, every other table at any
    // other version; a transformed table gives its stored length next.
    if (GLYF_OR_LOCA.has(known) === (flags >> 6 === 0))
      [length, at] = base128(buf, at);
    if (known === CMAP) cmap = { length, offset };
    offset += length;
  }
  if (!cmap) throw new Error('no character map');
  return { cmap, tables: at };
}

function characterMap(file: string): Buffer {
  const buf = readFileSync(file);
  expect(buf.toString('latin1', 0, 4)).toBe('wOF2');
  const { cmap, tables } = directory(buf);
  const data = brotliDecompressSync(
    buf.subarray(tables, tables + buf.readUInt32BE(20)),
  );
  return data.subarray(cmap.offset, cmap.offset + cmap.length);
}

// Format 4: segments of 16-bit codes, each mapped by a delta or a range.
function segmented(c: Buffer, sub: number, code: number): boolean {
  const segX2 = c.readUInt16BE(sub + 6);
  for (let s = 0; s < segX2 / 2; s++) {
    const end = c.readUInt16BE(sub + 14 + s * 2);
    const start = c.readUInt16BE(sub + 16 + segX2 + s * 2);
    if (code < start || code > end || code === 0xffff) continue;
    const delta = c.readInt16BE(sub + 16 + segX2 * 2 + s * 2);
    const rangeAt = sub + 16 + segX2 * 3 + s * 2;
    const range = c.readUInt16BE(rangeAt);
    const raw =
      range === 0 ? code : c.readUInt16BE(rangeAt + range + (code - start) * 2);
    return raw !== 0 && ((raw + delta) & 0xffff) !== 0;
  }
  return false;
}

// Format 12: groups of consecutive codes.
function grouped(c: Buffer, sub: number, code: number): boolean {
  for (let g = 0; g < c.readUInt32BE(sub + 12); g++) {
    const start = c.readUInt32BE(sub + 16 + g * 12);
    if (code >= start && code <= c.readUInt32BE(sub + 20 + g * 12)) return true;
  }
  return false;
}

// The code points among `codes` the font's character map draws a glyph for.
function drawn(file: string, codes: readonly number[]): number[] {
  const c = characterMap(file);
  const subtables = Array.from({ length: c.readUInt16BE(2) }, (_, i) =>
    c.readUInt32BE(8 + i * 8),
  );
  const draws = (code: number) =>
    subtables.some((sub) => {
      const format = c.readUInt16BE(sub);
      if (format === 4) return segmented(c, sub, code);
      return format === 12 && grouped(c, sub, code);
    });
  return codes.filter(draws);
}

const hex = (code: number) =>
  `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
const file = (name: string) =>
  require.resolve(`@fontsource/michroma/files/${name}`);

// @traces 1193-FR-009
describe('the Michroma heading font', () => {
  // Ș ș Ț ț, the comma-below letters Romanian is written with.
  const ROMANIAN = [0x0218, 0x0219, 0x021a, 0x021b];

  it('draws every comma-below letter of Romanian in the file a Romanian page loads', () => {
    const missing = ROMANIAN.filter(
      (code) =>
        !drawn(file('michroma-latin-ext-400-normal.woff2'), ROMANIAN).includes(
          code,
        ),
    );

    expect(missing.map(hex)).toEqual([]);
  });

  it('is read right: the Latin file draws A and lacks the Romanian letters', () => {
    const latin = file('michroma-latin-400-normal.woff2');

    expect(drawn(latin, [0x41])).toEqual([0x41]);
    expect(drawn(latin, ROMANIAN)).toEqual([]);
  });
});
