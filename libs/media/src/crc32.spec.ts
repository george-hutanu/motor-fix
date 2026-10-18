// @traces 1191-FR-006
import { crc32 as nodeCrc32 } from 'node:zlib';

import { crc32, crc32Base64 } from './crc32';

const base64Of = (sum: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(sum);
  return bytes.toString('base64');
};

describe('crc32', () => {
  const megabyte = Uint8Array.from(
    { length: 1024 * 1024 },
    (_, i) => (i * 31 + 7) & 0xff,
  );

  it.each([
    ['an empty input', new Uint8Array()],
    ['a few bytes', new TextEncoder().encode('jpeg bytes')],
    ['one megabyte', megabyte],
  ])('equals the CRC32 Node computes for %s', (_, bytes) => {
    expect(crc32(bytes)).toBe(nodeCrc32(bytes));
  });

  it('reads the check value of the standard test string', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('declares a blob as the base64 of its big-endian CRC32', async () => {
    const bytes = new TextEncoder().encode('jpeg bytes');

    const sum = await crc32Base64(new Blob([bytes]));

    expect(sum).toBe(base64Of(nodeCrc32(bytes)));
    expect(sum).toMatch(/^[A-Za-z0-9+/]{6}==$/);
  });

  it('declares an empty blob as AAAAAA==', async () => {
    await expect(crc32Base64(new Blob([]))).resolves.toBe('AAAAAA==');
  });
});
