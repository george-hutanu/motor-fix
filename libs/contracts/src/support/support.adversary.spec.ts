import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SUPPORT_TOPICS, supportReference } from './support';
import { CreateSupportMessageDto } from './support.dto';

const SUPPORT_REFERENCE_PATTERN = /^MF-\d{4}-\d{6,}$/;

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const valid = (over: Record<string, unknown> = {}) =>
  plainToInstance(CreateSupportMessageDto, {
    email: 'ana@example.test',
    language: 'ro',
    message: 'Nu pot vedea cererea trimisă ieri.',
    name: 'Ana Pop',
    topic: 'account',
    ...over,
  });

// @traces 280-FR-005 280-FR-010
describe('the contact message under hostile input', () => {
  it('accepts a message of exactly 20 and exactly 2000 characters after trimming', () => {
    expect(problems(valid({ message: `  ${'a'.repeat(20)}  ` }))).toEqual([]);
    expect(problems(valid({ message: 'a'.repeat(2000) }))).toEqual([]);
  });

  it('refuses 19 and 2001 characters', () => {
    expect(problems(valid({ message: 'a'.repeat(19) }))).toEqual(['message']);
    expect(problems(valid({ message: 'a'.repeat(2001) }))).toEqual(['message']);
  });

  it('refuses a message that is 20 characters only with the padding', () => {
    expect(
      problems(valid({ message: `${' '.repeat(10)}abc${' '.repeat(10)}` })),
    ).toEqual(['message']);
  });

  it('accepts a name of 80 and refuses 81 and a name of only spaces', () => {
    expect(problems(valid({ name: 'a'.repeat(80) }))).toEqual([]);
    expect(problems(valid({ name: 'a'.repeat(81) }))).toEqual(['name']);
    expect(problems(valid({ name: '     ' }))).toEqual(['name']);
    expect(problems(valid({ name: '' }))).toEqual(['name']);
  });

  it('counts a name of 80 emoji as 80 characters, not 160', () => {
    expect(problems(valid({ name: '😀'.repeat(80) }))).toEqual([]);
  });

  it('accepts an address of 254 characters and refuses 255', () => {
    const at = (n: number) =>
      `${'a'.repeat(n - '@example.test'.length)}@example.test`;
    expect(problems(valid({ email: at(254) }))).toEqual([]);
    expect(problems(valid({ email: at(255) }))).toEqual(['email']);
  });

  it.each([
    'ana',
    'ana@',
    '@example.test',
    'ana@@example.test',
    'ana example@example.test',
    'ana@example.test\r\nBcc: x@example.test',
    '',
    '   ',
  ])('refuses the address %j', (email) => {
    expect(problems(valid({ email }))).toEqual(['email']);
  });

  it.each([123, null, undefined, {}, [], true])(
    'refuses %j as the name, the address and the message',
    (value) => {
      expect(problems(valid({ name: value }))).toEqual(['name']);
      expect(problems(valid({ email: value }))).toEqual(['email']);
      expect(problems(valid({ message: value }))).toEqual(['message']);
    },
  );

  it.each([
    '',
    'ACCOUNT',
    'account ',
    'admin',
    '__proto__',
    'constructor',
    null,
    1,
  ])('refuses the topic %j', (topic) => {
    expect(problems(valid({ topic }))).toEqual(['topic']);
  });

  it.each(['', 'RO', 'fr', 'ro-RO', null, 1])(
    'refuses the language %j',
    (language) => {
      expect(problems(valid({ language }))).toEqual(['language']);
    },
  );

  it('accepts a subject reference of 40 and refuses 41 or a number', () => {
    expect(problems(valid({ subjectRef: 'a'.repeat(40) }))).toEqual([]);
    expect(problems(valid({ subjectRef: 'a'.repeat(41) }))).toEqual([
      'subjectRef',
    ]);
    expect(problems(valid({ subjectRef: 42 }))).toEqual(['subjectRef']);
  });

  it('refuses a trap field that is not a string', () => {
    expect(problems(valid({ website: 1 }))).toEqual(['website']);
    expect(problems(valid({ website: ['x'] }))).toEqual(['website']);
  });

  it.each(['role', 'accountId', 'reference', 'createdAt'])(
    'refuses an extra field %s, so the role cannot be sent in the body',
    (field) => {
      expect(problems(valid({ [field]: 'admin' }))).toEqual([field]);
    },
  );

  it('does not let a null subject reference through as a string', () => {
    expect(problems(valid({ subjectRef: null }))).toEqual([]);
  });
});

// @traces 280-FR-014
describe('the reference', () => {
  it.each([
    [2026, 1, 'MF-2026-000001'],
    [2026, 999999, 'MF-2026-999999'],
    [2026, 1000000, 'MF-2026-1000000'],
    [2027, 0, 'MF-2027-000000'],
  ])('formats year %d and count %d as %s', (year, n, expected) => {
    expect(supportReference(year, n)).toBe(expected);
    expect(SUPPORT_REFERENCE_PATTERN.test(expected)).toBe(true);
  });

  it.each([
    'MF-2026-00001',
    'mf-2026-000001',
    'MF-26-000001',
    'MF-2026-000001\n',
    ' MF-2026-000001',
    'MF-2026-000001x',
    'MF-2026-٠٠٠٠٠١',
    '',
  ])('does not match %j', (value) => {
    expect(SUPPORT_REFERENCE_PATTERN.test(value)).toBe(false);
  });

  it('lists five distinct topics', () => {
    expect(new Set(SUPPORT_TOPICS).size).toBe(5);
  });
});
