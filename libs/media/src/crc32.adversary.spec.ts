// @traces 1191-FR-006
import { crc32 as nodeCrc32 } from 'node:zlib';

import { crc32, crc32Base64 } from './crc32';

const expectedBase64 = (bytes: Uint8Array) => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(nodeCrc32(bytes));
  return out.toString('base64');
};

describe('crc32 against hostile input', () => {
  it('reads only the window of a view, not the buffer behind it', () => {
    const behind = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);

    expect(crc32(behind.subarray(2, 5))).toBe(
      nodeCrc32(Uint8Array.of(1, 2, 3)),
    );
  });

  it('is unsigned for a sum whose top bit is set', () => {
    const bytes = new TextEncoder().encode('123456789');

    expect(crc32(bytes)).toBeGreaterThan(0x7fffffff);
    expect(crc32(bytes)).toBe(0xcbf43926);
  });

  it('agrees with Node on every single byte value', () => {
    for (let b = 0; b < 256; b++) {
      expect(crc32(Uint8Array.of(b))).toBe(nodeCrc32(Uint8Array.of(b)));
    }
  });

  it('agrees with Node on 12 MB of binary noise', () => {
    let seed = 12345;
    const noise = Uint8Array.from({ length: 12 * 1024 * 1024 }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed & 0xff;
    });

    expect(crc32(noise)).toBe(nodeCrc32(noise));
  });

  it('declares an empty file as four zero bytes', async () => {
    expect(await crc32Base64(new File([], 'gol.jpg'))).toBe('AAAAAA==');
  });

  it('declares bytes outside ASCII without mangling them', async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x80, 0x00, 0xfe]);

    expect(await crc32Base64(new File([bytes], 'a.jpg'))).toBe(
      expectedBase64(bytes),
    );
  });

  it('declares a sum with a high bit set as the big-endian base64 of four bytes', async () => {
    const bytes = new TextEncoder().encode('123456789');

    expect(await crc32Base64(new File([bytes], 'a.jpg'))).toBe('y/Q5Jg==');
  });
});
