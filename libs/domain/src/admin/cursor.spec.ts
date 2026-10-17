import { decodeCursor, encodeCursor } from './cursor';

const ID = '0b6f2a52-3f7e-4c1a-9a6b-8f2d1c3e4a5b';
const AT = new Date('2026-10-17T08:15:00.123Z');
const raw = (text: string) => Buffer.from(text).toString('base64url');

// @traces 299-FR-002
describe('the list cursor', () => {
  it('gives back the instant and id it was made from', () => {
    expect(decodeCursor(encodeCursor(AT, ID))).toEqual({ at: AT, id: ID });
  });

  it('is url-safe text that does not show the instant or the id', () => {
    const cursor = encodeCursor(AT, ID);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(ID);
  });

  it('tells apart two entries of the same instant by their id', () => {
    const other = '0b6f2a52-3f7e-4c1a-9a6b-8f2d1c3e4a5c';

    expect(encodeCursor(AT, ID)).not.toBe(encodeCursor(AT, other));
    expect(decodeCursor(encodeCursor(AT, other)).id).toBe(other);
  });

  it.each([
    ['longer than 200 characters', 'A'.repeat(201)],
    ['not base64url', 'abc+/='],
    ['one part', raw(AT.toISOString())],
    ['three parts', raw(`${AT.toISOString()}|${ID}|x`)],
    ['words', raw('x|y')],
    ['a date that does not round-trip', raw(`2026-02-30T00:00:00.000Z|${ID}`)],
    ['a date without milliseconds', raw(`2026-10-17T08:15:00Z|${ID}`)],
    ['an id that is not a uuid', raw(`${AT.toISOString()}|entry-1`)],
    ['nothing', ''],
  ])('refuses a cursor that is %s', (_, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow();
  });
});
