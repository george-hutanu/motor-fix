import { normalisePhone, rewritePhone } from './phone';

describe('a phone number as the person types it', () => {
  it.each([
    ['international, with spaces', '+40 722 123 456'],
    ['national, with dashes', '0722-123-456'],
    ['with the 00 prefix', '0040722123456'],
    ['with dots and brackets', '(0722) 123.456'],
    ['already E.164', '+40722123456'],
    ['with spaces around it', '  0722 123 456 '],
  ])('reads %s as one number', (_, typed) => {
    expect(normalisePhone(typed)).toBe('+40722123456');
  });

  it('keeps a number from another country as it is', () => {
    expect(normalisePhone('+44 20 7946 0958')).toBe('+442079460958');
  });

  it.each([
    ['seven digits', '+1234567'],
    ['fifteen digits', '+123456789012345'],
  ])('accepts the shortest and the longest: %s', (_, typed) => {
    expect(normalisePhone(typed)).toBe(typed);
  });

  it.each([
    ['letters', '0722 ABC 456'],
    ['too short', '+123456'],
    ['too long', '+1234567890123456'],
    ['a country code starting with 0', '+0722123456'],
    ['nothing', ''],
    ['only separators', ' - . '],
    ['two plus signs', '++40722123456'],
    ['a plus in the middle', '07+22123456'],
  ])('refuses %s', (_, typed) => {
    expect(normalisePhone(typed)).toBeNull();
  });
});

// @traces 002-find-account-search-FR-004
describe('a phone number rewritten for a search', () => {
  it.each([
    ['0722 123 456', '+40722123456'],
    ['0040722123456', '+40722123456'],
    ['+40 (722) 123.456', '+40722123456'],
    ['0722', '+40722'],
    ['722-123', '722123'],
    ['+44 7700', '+447700'],
  ])('rewrites %s as %s, however short', (typed, rewritten) => {
    expect(rewritePhone(typed)).toBe(rewritten);
  });

  it('leaves letters for the caller to refuse', () => {
    expect(rewritePhone('0722 ABC')).toBe('+40722ABC');
  });
});
