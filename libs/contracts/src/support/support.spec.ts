import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  SUPPORT_REFERENCE_PATTERN,
  SUPPORT_TOPICS,
  supportReference,
} from './support';
import { CreateSupportMessageDto } from './support.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const TEXT = 'Nu pot vedea cererea trimisă ieri.';
const message = (over: Record<string, unknown> = {}) =>
  plainToInstance(CreateSupportMessageDto, {
    email: 'ana@example.test',
    language: 'ro',
    message: TEXT,
    name: 'Ana Pop',
    topic: 'account',
    ...over,
  });

// @traces 280-FR-005 280-FR-010 280-FR-022
describe('CreateSupportMessageDto', () => {
  it('accepts a complete message and trims the name and the text', () => {
    const dto = message({
      message: `  ${TEXT}  `,
      name: '  Ana Pop ',
      subjectRef: 'c0ffee00-1234-4abc-8def-0123456789ab',
    });

    expect(problems(dto)).toEqual([]);
    expect(dto).toMatchObject({ message: TEXT, name: 'Ana Pop' });
  });

  it('accepts each of the five topics', () => {
    expect(SUPPORT_TOPICS).toEqual([
      'request_or_booking',
      'account',
      'reviews',
      'listing',
      'other',
    ]);
    for (const topic of SUPPORT_TOPICS) {
      expect(problems(message({ topic }))).toEqual([]);
    }
  });

  it('accepts the edges: a one-letter name, 20 and 2,000 letters, 254 for the address', () => {
    const local = 'a'.repeat(254 - '@example.test'.length);
    expect(
      problems(
        message({
          email: `${local}@example.test`,
          message: 'x'.repeat(20),
          name: 'A',
        }),
      ),
    ).toEqual([]);
    expect(problems(message({ message: 'x'.repeat(2000) }))).toEqual([]);
    expect(problems(message({ name: 'n'.repeat(80) }))).toEqual([]);
  });

  it.each([
    ['name', ''],
    ['name', '   '],
    ['name', 'n'.repeat(81)],
    ['name', 42],
    ['email', ''],
    ['email', 'not-an-address'],
    ['email', `${'a'.repeat(250)}@example.test`],
    ['topic', 'billing'],
    ['topic', undefined],
    ['message', 'x'.repeat(19)],
    ['message', `  ${'x'.repeat(19)}  `],
    ['message', 'x'.repeat(2001)],
    ['language', 'de'],
    ['language', undefined],
    ['subjectRef', 'r'.repeat(41)],
    ['subjectRef', 7],
  ])('refuses %s = %p', (field, value) => {
    expect(problems(message({ [field]: value }))).toEqual([field]);
  });

  it('refuses a role in the body: the session decides it', () => {
    expect(problems(message({ role: 'admin' }))).toEqual(['role']);
  });

  it('lets the trap field through so the API can answer it quietly', () => {
    expect(problems(message({ website: 'https://spam.test' }))).toEqual([]);
  });
});

// @traces 280-FR-014 280-FR-022
describe('the support reference', () => {
  it('is MF, the year and six digits', () => {
    expect(supportReference(2026, 1)).toBe('MF-2026-000001');
    expect(supportReference(2027, 123456)).toBe('MF-2027-123456');
  });

  it('keeps counting past six digits instead of wrapping', () => {
    expect(supportReference(2026, 1234567)).toBe('MF-2026-1234567');
  });

  it('is matched by the pattern the confirmation checks', () => {
    expect(SUPPORT_REFERENCE_PATTERN.test(supportReference(2026, 9))).toBe(
      true,
    );
    expect(SUPPORT_REFERENCE_PATTERN.test('MF-26-000009')).toBe(false);
  });
});
