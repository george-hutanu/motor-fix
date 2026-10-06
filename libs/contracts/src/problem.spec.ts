import { codeForStatus, fieldProblems } from './problem';

describe('fieldProblems', () => {
  it('keeps a list of field and code strings', () => {
    const list = [
      { code: 'email_taken', field: 'email' },
      { code: 'too_short', field: 'name' },
    ];

    expect(fieldProblems(list)).toEqual(list);
  });

  it('keeps only the field and the code of each entry', () => {
    expect(
      fieldProblems([{ code: 'email_taken', extra: 1, field: 'email' }]),
    ).toEqual([{ code: 'email_taken', field: 'email' }]);
  });

  it.each([
    ['nothing', undefined],
    ['a string', 'email_taken'],
    ['an object', { code: 'email_taken', field: 'email' }],
    ['an empty list', []],
    ['an entry without a field', [{ code: 'email_taken' }]],
    ['an entry with a number code', [{ code: 4, field: 'email' }]],
    ['null in the list', [null]],
    [
      'a function that carries a field and a code',
      [Object.assign(() => undefined, { code: 'email_taken', field: 'email' })],
    ],
    [
      'one bad entry among good ones',
      [{ code: 'email_taken', field: 'email' }, { field: 'name' }],
    ],
  ])('drops %s', (_, value) => {
    expect(fieldProblems(value)).toBeUndefined();
  });
});

describe('codeForStatus', () => {
  it.each([
    [400, 'validation_failed'],
    [404, 'not_found'],
    [409, 'conflict'],
    [503, 'service_unavailable'],
    [500, 'internal_error'],
    [502, 'internal_error'],
    [599, 'internal_error'],
    [401, 'error'],
    [418, 'error'],
    [0, 'error'],
  ])('maps %i to %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });
});
