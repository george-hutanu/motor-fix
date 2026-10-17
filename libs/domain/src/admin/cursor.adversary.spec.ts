import { decodeCursor, encodeCursor } from './cursor';

const ID = '0b6f2a52-3f7e-4c1a-9a6b-8f2d1c3e4a5b';
const raw = (text: string) => Buffer.from(text).toString('base64url');

// @traces 299-system-log-search-FR-002
describe('the list cursor under hostile input', () => {
  it.each([
    ['the epoch', new Date('1970-01-01T00:00:00.000Z')],
    ['the last millisecond of a day', new Date('2026-10-17T23:59:59.999Z')],
    ['the first millisecond of a day', new Date('2026-10-17T00:00:00.000Z')],
    ['year 9999', new Date('9999-12-31T23:59:59.999Z')],
  ])('round-trips %s', (_, at) => {
    expect(decodeCursor(encodeCursor(at, ID))).toEqual({ at, id: ID });
  });

  it('stays within the 200 characters the contract allows', () => {
    const cursor = encodeCursor(new Date('9999-12-31T23:59:59.999Z'), ID);

    expect(cursor.length).toBeLessThanOrEqual(200);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 12345],
    ['an object', { at: 1 }],
  ])('refuses %s', (_, cursor) => {
    expect(() => decodeCursor(cursor as unknown as string)).toThrow();
  });

  it.each([
    ['an offset instead of Z', raw(`2026-10-17T08:15:00.123+00:00|${ID}`)],
    ['a trailing newline on the id', raw(`2026-10-17T08:15:00.123Z|${ID}\n`)],
    ['a leading space on the instant', raw(` 2026-10-17T08:15:00.123Z|${ID}`)],
    ['an empty id', raw('2026-10-17T08:15:00.123Z|')],
    ['an empty instant', raw(`|${ID}`)],
    [
      'a unicode id of the right length',
      raw(`2026-10-17T08:15:00.123Z|${'é'.repeat(36)}`),
    ],
    [
      'a NUL byte in the id',
      raw(`2026-10-17T08:15:00.123Z|${ID.slice(0, 35)}\0`),
    ],
    ['padding', `${raw(`2026-10-17T08:15:00.123Z|${ID}`)}=`],
    ['standard base64 characters', 'a+b/'],
    ['a space', 'abc def'],
    ['exactly 201 valid characters', 'A'.repeat(201)],
  ])('refuses a cursor with %s', (_, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow();
  });

  it('answers the same for the same cursor twice', () => {
    const cursor = encodeCursor(new Date('2026-10-17T08:15:00.123Z'), ID);

    expect(decodeCursor(cursor)).toEqual(decodeCursor(cursor));
  });
});
