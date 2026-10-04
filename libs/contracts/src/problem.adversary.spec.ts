import { codeForStatus, fieldProblems } from './problem';

describe('fieldProblems under hostile input', () => {
  it.each([
    ['null', null],
    ['a number', 3],
    ['an array-like object', { 0: { code: 'a', field: 'b' }, length: 1 }],
    ['an entry with a numeric field', [{ code: 'a', field: 1 }]],
    ['an entry with null code', [{ code: null, field: 'a' }]],
    ['a nested array entry', [[{ code: 'a', field: 'b' }]]],
    ['a string entry', ['email']],
    ['a list whose last entry is bad', [{ code: 'a', field: 'b' }, 7]],
  ])('drops %s', (_, value) => {
    expect(fieldProblems(value)).toBeUndefined();
  });

  it('keeps a single-entry list', () => {
    expect(fieldProblems([{ code: 'a', field: 'b' }])).toEqual([
      { code: 'a', field: 'b' },
    ]);
  });

  it('keeps unicode and dotted field names as given', () => {
    expect(
      fieldProblems([
        { code: 'obligatoriu', field: 'nume_șî' },
        { code: 'x', field: 'address.city' },
      ]),
    ).toEqual([
      { code: 'obligatoriu', field: 'nume_șî' },
      { code: 'x', field: 'address.city' },
    ]);
  });

  it('handles ten thousand entries and keeps their order', () => {
    const list = Array.from({ length: 10000 }, (_, i) => ({
      code: 'c',
      field: `f${i}`,
    }));
    const out = fieldProblems(list);
    expect(out).toHaveLength(10000);
    expect(out?.[9999]).toEqual({ code: 'c', field: 'f9999' });
  });

  it('returns a copy and does not mutate the input', () => {
    const entry = { code: 'a', extra: 1, field: 'b' };
    const out = fieldProblems([entry]);
    expect(entry).toEqual({ code: 'a', extra: 1, field: 'b' });
    expect(out?.[0]).not.toBe(entry);
  });

  it('gives the same answer when called twice', () => {
    const list = [{ code: 'a', field: 'b' }];
    expect(fieldProblems(list)).toEqual(fieldProblems(list));
  });
});

describe('codeForStatus at the boundaries', () => {
  it.each([
    [499, 'error'],
    [500, 'internal_error'],
    [501, 'internal_error'],
    [504, 'internal_error'],
    [599, 'internal_error'],
    [600, 'error'],
    [399, 'error'],
    [200, 'error'],
    [-1, 'error'],
    [Number.NaN, 'error'],
    [Number.POSITIVE_INFINITY, 'error'],
    [402, 'error'],
    [422, 'error'],
  ])('maps %p to %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });

  it('does not read inherited object keys as statuses', () => {
    expect(codeForStatus('constructor' as unknown as number)).toBe('error');
    expect(codeForStatus('__proto__' as unknown as number)).toBe('error');
  });
});
