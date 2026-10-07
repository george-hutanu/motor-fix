import { scrub, scrubDeep } from './scrub';

// @traces 876-FR-012
describe('scrub', () => {
  it.each([
    ['contact ana.pop+cars@example.co.uk now', 'contact *** now'],
    ['call +40 722 123 456', 'call ***'],
    ['call 0040722123456', 'call ***'],
    ['call 0722.123.456', 'call ***'],
    ['call 0722-123-456', 'call ***'],
    ['landline 021 312 3456', 'landline ***'],
    ['landline 0264 123 456', 'landline ***'],
    ['plate B 123 ABC parked', 'plate *** parked'],
    ['plate cj-07-xyz parked', 'plate *** parked'],
    ['plate B07XYZ parked', 'plate *** parked'],
  ])('masks %j', (input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  it('masks every value in one message', () => {
    expect(scrub('a@b.ro, 0722123456 and IF 99 ABC')).toBe('***, *** and ***');
  });

  it.each([
    'job 42 finished in 1200 ms',
    'GET /api/v1/garages/9f1c2d3e',
    'order 2026-10-08 at 10:30',
    'request 7d3b0b42-7c1e-4a49-9d0e-6c1d2f6f0a11',
  ])('leaves %j unchanged', (input) => {
    expect(scrub(input)).toBe(input);
  });
});

describe('scrubDeep', () => {
  it('masks strings inside nested objects and arrays and keeps other values', () => {
    expect(
      scrubDeep({
        count: 3,
        list: ['x@y.ro', 'plain'],
        nested: { ok: true, phone: '0722 123 456' },
      }),
    ).toEqual({
      count: 3,
      list: ['***', 'plain'],
      nested: { ok: true, phone: '***' },
    });
  });

  it('does not change the value it was given', () => {
    const value = { email: 'x@y.ro' };
    scrubDeep(value);
    expect(value).toEqual({ email: 'x@y.ro' });
  });
});
