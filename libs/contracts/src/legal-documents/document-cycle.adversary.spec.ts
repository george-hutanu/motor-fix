import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  DOCUMENT_GRACE_DAYS,
  DocumentRefusalDto,
  DocumentsSubmitDto,
} from './document-cycle.dto';
import { DOCUMENT_REFUSAL_NOTE_MAX } from './legal-documents';

function check<T extends object>(type: new () => T, body: unknown) {
  const dto = plainToInstance(type, body as object);
  const errors = validateSync(dto, {
    forbidNonWhitelisted: true,
    whitelist: true,
  });
  return { dto, failed: errors.map((e) => e.property) };
}

const refusal = (note: unknown, reason: unknown = 'other') =>
  check(DocumentRefusalDto, { note, reason });

const key = (n: number) =>
  `incoming/legal_document/7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00/${n}`;

// @traces 068-FR-010
describe('the refusal note under hostile input', () => {
  it('takes exactly 500 characters and refuses 501', () => {
    expect(DOCUMENT_REFUSAL_NOTE_MAX).toBe(500);
    expect(refusal('a'.repeat(500)).failed).toEqual([]);
    expect(refusal('a'.repeat(501)).failed).toEqual(['note']);
  });

  it('measures the length after trimming, so 500 characters between spaces pass', () => {
    const { dto, failed } = refusal(`  ${'a'.repeat(500)}\n\t `);
    expect(failed).toEqual([]);
    expect(dto.note).toBe('a'.repeat(500));
  });

  it.each([
    ['one character', 'a'],
    ['a tab and a line break inside', 'a\tb\nc\r\nd'],
  ])('takes %s', (_, note) => {
    expect(refusal(note).failed).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['spaces', '     '],
    ['a no-break space and a line break', ' \n'],
    ['a tab and a line break', '\t\n\r'],
  ])('refuses a note that is %s', (_, note) => {
    expect(refusal(note).failed).toEqual(['note']);
  });

  it.each([
    ['null byte', 'a\u0000b'],
    ['delete', 'a\u007fb'],
    ['next line', 'a\u0085b'],
    ['escape', 'a\u001b[31mb'],
    ['bell', 'a\u0007'],
    ['a C1 control at the end', 'ab\u009f'],
  ])('refuses a note holding %s', (_, note) => {
    expect(refusal(note).failed).toEqual(['note']);
  });

  it('counts a character outside the basic plane as one', () => {
    expect(refusal('🚗'.repeat(500)).failed).toEqual([]);
  });

  it('takes Romanian diacritics and combining marks as written', () => {
    const note = 'Pagină ștearsă, ăîâșț é';
    expect(refusal(note).dto.note).toBe(note);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 12],
    ['an array', ['a']],
    ['an object', { length: 3 }],
    ['a boolean', true],
  ])('refuses %s as the note', (_, note) => {
    expect(refusal(note).failed).toEqual(['note']);
  });

  it.each([
    ['null', null],
    ['a different case', 'DOCUMENTS'],
    ['a padded reason', ' other'],
    ['a prototype key', '__proto__'],
    ['a constructor', 'constructor'],
    ['a list', ['other']],
    ['a number', 0],
  ])('refuses %s as the reason', (_, reason) => {
    expect(refusal('Notă', reason).failed).toEqual(['reason']);
  });

  it('refuses a field it does not know', () => {
    expect(
      check(DocumentRefusalDto, { extra: 1, note: 'Notă', reason: 'other' })
        .failed,
    ).toEqual(['extra']);
  });

  it('refuses an empty body', () => {
    expect(check(DocumentRefusalDto, {}).failed.sort()).toEqual([
      'note',
      'reason',
    ]);
  });
});

// @traces 068-FR-007
describe('the yearly upload body under hostile input', () => {
  const good = {
    issuedOn: '2026-10-20',
    kind: 'onrc_certificate',
    pages: [key(1)],
  };

  it.each([
    ['null', { documents: null }],
    ['an object', { documents: good }],
    ['a string', { documents: 'onrc_certificate' }],
    ['absent', {}],
  ])('refuses documents that are %s', (_, body) => {
    expect(check(DocumentsSubmitDto, body).failed).toEqual(['documents']);
  });

  it.each([
    ['null', null],
    ['a number', 7],
    ['a list', []],
  ])('refuses an entry that is %s', (_, entry) => {
    expect(check(DocumentsSubmitDto, { documents: [entry] }).failed).toEqual([
      'documents',
    ]);
  });

  it('refuses the same kind twice with different pages', () => {
    expect(
      check(DocumentsSubmitDto, {
        documents: [good, { ...good, pages: [key(2)] }],
      }).failed,
    ).toEqual(['documents']);
  });

  it('refuses a page key of 201 characters and takes 200', () => {
    expect(
      check(DocumentsSubmitDto, {
        documents: [{ ...good, pages: ['k'.repeat(200)] }],
      }).failed,
    ).toEqual([]);
    expect(
      check(DocumentsSubmitDto, {
        documents: [{ ...good, pages: ['k'.repeat(201)] }],
      }).failed,
    ).toEqual(['documents']);
  });

  it.each([
    ['a number', 7],
    ['null', null],
  ])('refuses a page that is %s', (_, page) => {
    expect(
      check(DocumentsSubmitDto, { documents: [{ ...good, pages: [page] }] })
        .failed,
    ).toEqual(['documents']);
  });

  it.each(['2026-13-01', '2026-00-10', '2026-04-31', '2025-02-29', '０２６'])(
    'refuses the issue date %s',
    (issuedOn) => {
      expect(
        check(DocumentsSubmitDto, { documents: [{ ...good, issuedOn }] })
          .failed,
      ).toEqual(['documents']);
    },
  );

  it('takes 29 February of a leap year as an issue date', () => {
    expect(
      check(DocumentsSubmitDto, {
        documents: [{ ...good, issuedOn: '2028-02-29' }],
      }).failed,
    ).toEqual([]);
  });

  it('refuses an unknown field inside an entry', () => {
    expect(
      check(DocumentsSubmitDto, { documents: [{ ...good, status: 'valid' }] })
        .failed,
    ).toEqual(['documents']);
  });
});

// @traces 068-FR-003
describe('the grace', () => {
  it('is 14 days', () => {
    expect(DOCUMENT_GRACE_DAYS).toBe(14);
  });
});
