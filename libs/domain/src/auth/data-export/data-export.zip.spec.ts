// @traces 140-FR-004
import { crc32, inflateRawSync } from 'node:zlib';

import { readZip } from './data-export.testing';
import { writeZip } from './data-export.zip';

const entries = [
  { data: '{"name":"Ștefan Țăran"}', name: 'account.json' },
  { data: '[]', name: 'cars.json' },
  {
    data: 'MotorFix\nDatele tale, cerute pe 2026-10-24.\n',
    name: 'README.txt',
  },
];

describe('the ZIP of an export', () => {
  it('gives back every file with its exact bytes', () => {
    const zip = writeZip(entries);

    const read = readZip(zip);

    expect([...read.keys()]).toEqual([
      'account.json',
      'cars.json',
      'README.txt',
    ]);
    for (const { data, name } of entries) {
      expect(read.get(name)?.toString('utf8')).toBe(data);
    }
  });

  it('starts with a local file header and ends with the end of the directory', () => {
    const zip = writeZip(entries);

    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(entries.length);
  });

  it('deflates each body and records its CRC-32 and both sizes', () => {
    const data = 'ab'.repeat(5000);
    const zip = writeZip([{ data, name: 'big.json' }]);

    expect(zip.readUInt16LE(8)).toBe(8);
    const crc = zip.readUInt32LE(14);
    const packed = zip.readUInt32LE(18);
    const size = zip.readUInt32LE(22);
    const nameLength = zip.readUInt16LE(26);
    const body = zip.subarray(30 + nameLength, 30 + nameLength + packed);
    expect(size).toBe(Buffer.byteLength(data));
    expect(packed).toBeLessThan(size);
    expect(crc).toBe(crc32(Buffer.from(data)));
    expect(inflateRawSync(body).toString()).toBe(data);
  });

  it('marks names as UTF-8 so a diacritic survives', () => {
    const zip = writeZip([{ data: 'x', name: 'mașini.json' }]);

    expect(zip.readUInt16LE(6) & 0x800).toBe(0x800);
    expect([...readZip(zip).keys()]).toEqual(['mașini.json']);
  });

  it('writes an empty archive that is still a valid ZIP', () => {
    const zip = writeZip([]);

    expect(zip.length).toBe(22);
    expect(readZip(zip).size).toBe(0);
  });
});
