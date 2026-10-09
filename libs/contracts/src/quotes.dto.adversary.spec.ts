import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SendQuoteDto } from './quotes.dto';

// @traces 344-FR-001

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const base = {
  durationMinutes: 120,
  fromLei: 650,
  requestId: '3f2b8c1e-5d4a-4b6f-8a7c-1d2e3f4a5b6c',
  slot: '2030-10-10T09:00:00+03:00',
  toLei: 800,
};
const quote = (over: Record<string, unknown>) =>
  plainToInstance(SendQuoteDto, { ...base, ...over });

describe('SendQuoteDto under hostile input', () => {
  it('accepts the plain quote', () => {
    expect(problems(quote({}))).toEqual([]);
  });

  it.each([
    ['zero', 0, ['fromLei']],
    ['one', 1, []],
    ['negative', -5, ['fromLei']],
    ['a decimal', 10.5, ['fromLei']],
    ['a numeric string', '650', ['fromLei']],
    ['null', null, ['fromLei']],
    ['NaN', Number.NaN, ['fromLei']],
    ['Infinity', Number.POSITIVE_INFINITY, ['fromLei']],
    ['one million', 1_000_000, []],
    ['one past a million', 1_000_001, ['fromLei']],
  ])('low price of %s', (_, fromLei, expected) => {
    expect(problems(quote({ fromLei, toLei: 1_000_000 }))).toEqual(expected);
  });

  it.each([
    ['zero', 0],
    ['one past a million', 1_000_001],
    ['a decimal', 800.5],
    ['a string', '800'],
    ['null', null],
  ])('high price of %s is refused naming toLei', (_, toLei) => {
    expect(problems(quote({ toLei }))).toContain('toLei');
  });

  it('accepts a range of one lei to one lei', () => {
    expect(problems(quote({ fromLei: 1, toLei: 1 }))).toEqual([]);
  });

  it('accepts the widest range', () => {
    expect(problems(quote({ fromLei: 1, toLei: 1_000_000 }))).toEqual([]);
  });

  it('accepts a low price equal to the high one', () => {
    expect(problems(quote({ fromLei: 800, toLei: 800 }))).toEqual([]);
  });

  it.each([
    ['14', 14, ['durationMinutes']],
    ['zero', 0, ['durationMinutes']],
    ['15', 15, []],
    ['16', 16, ['durationMinutes']],
    ['30', 30, []],
    ['7185', 7185, []],
    ['7200', 7200, []],
    ['7201', 7201, ['durationMinutes']],
    ['7215', 7215, ['durationMinutes']],
    ['negative', -15, ['durationMinutes']],
    ['a decimal', 15.5, ['durationMinutes']],
    ['a string', '15', ['durationMinutes']],
    ['null', null, ['durationMinutes']],
  ])('duration of %s', (_, durationMinutes, expected) => {
    expect(problems(quote({ durationMinutes }))).toEqual(expected);
  });

  it.each([
    ['Z', '2030-10-10T06:00:00Z', []],
    ['a positive offset', '2030-10-10T09:00:00+03:00', []],
    ['a negative offset', '2030-10-10T01:00:00-05:00', []],
    ['milliseconds with Z', '2030-10-10T06:00:00.000Z', []],
    ['no offset', '2030-10-10T09:00:00', ['slot']],
    ['a date alone', '2030-10-10', ['slot']],
    ['an offset without a colon', '2030-10-10T09:00:00+0300', ['slot']],
    ['an impossible day', '2030-02-30T09:00:00Z', ['slot']],
    ['an impossible hour', '2030-10-10T25:00:00Z', ['slot']],
    ['free text', 'tomorrow at nine', ['slot']],
    ['empty', '', ['slot']],
    ['a number', 1_900_000_000_000, ['slot']],
    ['null', null, ['slot']],
  ])('slot of %s', (_, slot, expected) => {
    expect(problems(quote({ slot }))).toEqual(expected);
  });

  it('refuses a missing slot', () => {
    const { slot: _slot, ...rest } = base;
    expect(problems(plainToInstance(SendQuoteDto, rest))).toEqual(['slot']);
  });

  it.each([
    ['requestId', 'not-a-uuid'],
    ['requestId', ''],
    ['requestId', null],
    ['requestId', 42],
  ])('%s of %p is refused', (field, value) => {
    expect(problems(quote({ [field]: value }))).toEqual([field]);
  });

  it('refuses a field the contract does not name', () => {
    expect(problems(quote({ garageId: base.requestId }))).toEqual(['garageId']);
  });

  describe('note', () => {
    const noteOf = (note: unknown) => {
      const dto = quote({ note });
      return { dto, found: problems(dto) };
    };

    it('may be left out', () => {
      expect(problems(quote({}))).toEqual([]);
    });

    it('may be null', () => {
      expect(noteOf(null).found).toEqual([]);
    });

    it.each([
      ['empty', ''],
      ['spaces', '   '],
      ['tabs and newlines', ' \t\n\r '],
    ])('of %s becomes no note', (_, note) => {
      const { dto, found } = noteOf(note);
      expect(found).toEqual([]);
      expect(dto.note ?? null).toBeNull();
    });

    it('is trimmed on both ends', () => {
      const { dto, found } = noteOf('  Include plăcuțe și discuri \n');
      expect(found).toEqual([]);
      expect(dto.note).toBe('Include plăcuțe și discuri');
    });

    it('may be exactly 500 characters', () => {
      expect(noteOf('a'.repeat(500)).found).toEqual([]);
    });

    it('may be 500 characters inside padding', () => {
      expect(noteOf(`  ${'a'.repeat(500)}  `).found).toEqual([]);
    });

    it('is refused at 501 characters', () => {
      expect(noteOf('a'.repeat(501)).found).toEqual(['note']);
    });

    it('is refused at 501 characters after trimming', () => {
      expect(noteOf(` ${'a'.repeat(501)} `).found).toEqual(['note']);
    });

    it('counts a diacritic as one character', () => {
      expect(noteOf('ț'.repeat(500)).found).toEqual([]);
    });

    it('counts an emoji as one character', () => {
      expect(noteOf('😀'.repeat(300)).found).toEqual([]);
    });

    it.each([
      ['a number', 42],
      ['a boolean', true],
      ['an array', ['a']],
      ['an object', { text: 'a' }],
    ])('of %s is refused', (_, note) => {
      expect(noteOf(note).found).toEqual(['note']);
    });
  });
});
