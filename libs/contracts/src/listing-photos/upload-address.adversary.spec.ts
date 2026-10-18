// @traces 1191-FR-006
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PhotoUploadRequestDto } from './listing-photos.dto';
import { DocumentUploadRequestDto } from '../legal-documents/legal-documents.dto';

const problems = (type: new () => object, body: Record<string, unknown>) =>
  validateSync(plainToInstance(type, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((e) => e.property);

const base = { contentType: 'image/jpeg', size: 1024 };

describe.each([
  ['PhotoUploadRequestDto', PhotoUploadRequestDto],
  ['DocumentUploadRequestDto', DocumentUploadRequestDto],
])('%s checksum, hostile values', (_name, type) => {
  it.each([
    ['null', null],
    ['a number', 123456789],
    ['an array holding a valid sum', ['yPQ5Jg==']],
    ['an object', { sum: 'yPQ5Jg==' }],
    ['true', true],
    ['the empty string', ''],
    ['a valid sum with a trailing newline', 'yPQ5Jg==\n'],
    ['a valid sum with a leading space', ' yPQ5Jg=='],
    ['a valid sum followed by a second one', 'yPQ5Jg==yPQ5Jg=='],
    ['a base64url sum', 'yPQ5-g=='],
    ['a sum without padding', 'yPQ5Jg'],
    ['a sum with one padding character', 'yPQ5Jg='],
    ['a sum with three padding characters', 'yPQ5Jg==='],
    ['three bytes of base64', 'yPQ5'],
    ['five bytes of base64', 'yPQ5Jgo='],
    ['eight bytes of base64', 'yPQ5JiQ5Jg=='],
    ['a sixth character with stray low bits', 'yPQ5Jh=='],
    ['a full-width digit in place of an ASCII one', 'yPQ５Jg=='],
    ['an accented letter', 'yPQé3g=='],
    ['a 10 kB string', 'A'.repeat(10_000)],
    ['a zero-width space inside', 'yP​Q5Jg=='],
  ])('refuses %s', (_what, checksum) => {
    expect(problems(type, { ...base, checksum })).toEqual(['checksum']);
  });

  it('refuses a body with the checksum under another name', () => {
    expect(problems(type, { ...base, crc32: 'yPQ5Jg==' }).sort()).toEqual([
      'checksum',
      'crc32',
    ]);
  });

  it('refuses a body that carries only a checksum', () => {
    expect(problems(type, { checksum: 'yPQ5Jg==' }).sort()).toEqual([
      'contentType',
      'size',
    ]);
  });

  it.each([0, -1, 1.5, '1024', null, Number.NaN])(
    'still refuses a size of %p next to a valid checksum',
    (size) => {
      expect(problems(type, { ...base, checksum: 'yPQ5Jg==', size })).toEqual([
        'size',
      ]);
    },
  );
});
