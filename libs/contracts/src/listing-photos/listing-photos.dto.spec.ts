import { crc32 } from 'node:zlib';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PhotoUploadRequestDto } from './listing-photos.dto';
import { DocumentUploadRequestDto } from '../legal-documents/legal-documents.dto';

const sumOf = (text: string) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(crc32(Buffer.from(text)));
  return bytes.toString('base64');
};

const problems = (
  type: typeof PhotoUploadRequestDto,
  body: Record<string, unknown>,
) =>
  validateSync(plainToInstance(type, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((e) => e.property);

const base = { contentType: 'image/jpeg', size: 1024 };

// @traces 1191-FR-006
describe.each([
  ['PhotoUploadRequestDto', PhotoUploadRequestDto],
  ['DocumentUploadRequestDto', DocumentUploadRequestDto],
])('%s checksum', (_name, type) => {
  it.each([
    ['the CRC32 of a short text', sumOf('motorfix')],
    ['the CRC32 of nothing', sumOf('')],
    ['the largest CRC32', '/////w=='],
    ['a CRC32 with + and /', 'a+b/Qw=='],
  ])('accepts %s', (_what, checksum) => {
    expect(problems(type, { ...base, checksum })).toEqual([]);
  });

  it('refuses a request without a checksum', () => {
    expect(problems(type, base)).toEqual(['checksum']);
  });

  it.each([
    ['empty', ''],
    ['without padding', 'yPQ5Jg'],
    ['with one pad', 'yPQ5Jg='],
    ['too long', 'yPQ5JgA=='],
    ['too short', 'yPQ5J=='],
    ['url-safe characters', 'yPQ-_g=='],
    ['a trailing newline', 'yPQ5Jg==\n'],
    ['a leading space', ' yPQ5Jg=='],
    ['hex', 'c8f43926'],
    ['bits beyond the 32', 'yPQ5Jh=='],
    ['a number', 12345678],
    ['an array', ['yPQ5Jg==']],
  ])('refuses a checksum that is %s', (_what, checksum) => {
    expect(problems(type, { ...base, checksum })).toEqual(['checksum']);
  });
});
