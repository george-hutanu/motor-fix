// @traces 140-FR-004
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeZip } from './data-export.zip';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zip-adversary-'));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

async function save(zip: Buffer) {
  const path = join(dir, 'out.zip');
  await writeFile(path, zip);
  return path;
}

const unzip = (...args: string[]) =>
  execFileSync('unzip', args, { maxBuffer: 256 * 1024 * 1024 });

describe('the ZIP of an export read by unzip', () => {
  it('passes the integrity test of unzip for ten files', async () => {
    const names = [
      'account.json',
      'cars.json',
      'requests-and-quotes.json',
      'bookings-and-jobs.json',
      'reviews.json',
      'messages.json',
      'notifications-and-preferences.json',
      'consents.json',
      'audit.json',
      'README.txt',
    ];
    const path = await save(
      writeZip(names.map((name) => ({ data: '[]', name }))),
    );

    const out = unzip('-t', path).toString();

    expect(out).toContain('No errors detected');
    for (const name of names) expect(out).toContain(`testing: ${name}`);
  });

  it('hands back an empty file as zero bytes', async () => {
    const path = await save(writeZip([{ data: '', name: 'empty.json' }]));

    expect(unzip('-t', path).toString()).toContain('No errors detected');
    expect(unzip('-p', path, 'empty.json').length).toBe(0);
  });

  it('keeps binary bytes exactly, including every byte value', async () => {
    const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const path = await save(writeZip([{ data: all, name: 'raw.bin' }]));

    expect(unzip('-p', path, 'raw.bin').equals(all)).toBe(true);
  });

  it('keeps an incompressible 8 MB body intact', async () => {
    const noise = randomBytes(8 * 1024 * 1024);
    const path = await save(writeZip([{ data: noise, name: 'noise.bin' }]));

    expect(unzip('-t', path).toString()).toContain('No errors detected');
    expect(unzip('-p', path, 'noise.bin').equals(noise)).toBe(true);
  });

  it('keeps UTF-8 text with emoji and combining marks exactly', async () => {
    const text = 'Șoferul 🚗 e\u0301 — ţară "\\u0000"\r\n\u2028';
    const path = await save(writeZip([{ data: text, name: 'account.json' }]));

    expect(unzip('-p', path, 'account.json').toString('utf8')).toBe(text);
  });

  it('writes the central directory name as UTF-8 with the UTF-8 flag set', () => {
    const zip = writeZip([{ data: 'x', name: 'mașini-🚗.json' }]);
    const start = zip.readUInt32LE(zip.length - 22 + 16);

    const length = zip.readUInt16LE(start + 28);

    expect(zip.readUInt16LE(start + 8) & 0x800).toBe(0x800);
    expect(zip.toString('utf8', start + 46, start + 46 + length)).toBe(
      'mașini-🚗.json',
    );
  });

  it('keeps 2000 files with their own contents and offsets', async () => {
    const entries = Array.from({ length: 2000 }, (_, i) => ({
      data: `file ${i}`,
      name: `f${i}.txt`,
    }));
    const path = await save(writeZip(entries));

    expect(unzip('-t', path).toString()).toContain('No errors detected');
    expect(unzip('-p', path, 'f1999.txt').toString()).toBe('file 1999');
    expect(unzip('-p', path, 'f0.txt').toString()).toBe('file 0');
  });

  it('records the entry count in the end of the directory for 2000 files', () => {
    const zip = writeZip(
      Array.from({ length: 2000 }, (_, i) => ({ data: 'x', name: `${i}` })),
    );

    expect(zip.readUInt16LE(zip.length - 22 + 8)).toBe(2000);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2000);
  });

  it('points the end record at the start of the central directory', () => {
    const zip = writeZip([
      { data: 'one', name: 'a.txt' },
      { data: 'two', name: 'b.txt' },
    ]);
    const end = zip.length - 22;

    const start = zip.readUInt32LE(end + 16);
    const size = zip.readUInt32LE(end + 12);

    expect(zip.readUInt32LE(start)).toBe(0x02014b50);
    expect(start + size).toBe(end);
  });

  it('points each central entry at its own local header', () => {
    const zip = writeZip([
      { data: 'one', name: 'a.txt' },
      { data: 'two two two', name: 'b.txt' },
    ]);
    const end = zip.length - 22;
    let cursor = zip.readUInt32LE(end + 16);
    const seen: string[] = [];

    for (let i = 0; i < 2; i++) {
      const nameLength = zip.readUInt16LE(cursor + 28);
      const offset = zip.readUInt32LE(cursor + 42);
      expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
      seen.push(zip.toString('utf8', cursor + 46, cursor + 46 + nameLength));
      cursor += 46 + nameLength;
    }

    expect(seen).toEqual(['a.txt', 'b.txt']);
  });

  it('refuses a file name longer than the format allows', () => {
    expect(() => writeZip([{ data: 'x', name: 'a'.repeat(70000) }])).toThrow(
      /out of range/,
    );
  });

  it('refuses more files than the end record can count rather than writing a wrong count', () => {
    const entries = Array.from({ length: 65536 }, (_, i) => ({
      data: '',
      name: `${i}`,
    }));

    expect(() => writeZip(entries)).toThrow();
  });

  it('gives the same bytes for the same input twice', () => {
    const entries = [{ data: 'same', name: 'a.txt' }];

    expect(writeZip(entries).equals(writeZip(entries))).toBe(true);
  });
});
