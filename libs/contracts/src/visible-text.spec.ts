import {
  CATALOGUE_JOB_NAME,
  REJECTION_REASON,
  visibleLength,
  visibleTextProblem,
} from './visible-text';

describe('visible text', () => {
  it('counts what shows: trimmed, an emoji as one, zero-width marks left out', () => {
    expect(visibleLength('  ab  ')).toBe(2);
    expect(visibleLength('\u{1F600}\u{1F600}')).toBe(2);
    expect(visibleLength('a​b‍')).toBe(2);
    expect(visibleLength('​​​')).toBe(0);
  });

  it('refuses a control character in a name, a line break included', () => {
    for (const name of ['Ulei\u0000motor', 'Ulei\nmotor', 'Ulei\u0085motor'])
      expect(visibleTextProblem(name, CATALOGUE_JOB_NAME)).toBe('control');
  });

  it('lets a reason run over lines but refuses its other control characters', () => {
    expect(
      visibleTextProblem('Prima linie.\r\n\tA doua.', REJECTION_REASON),
    ).toBeNull();
    expect(
      visibleTextProblem('Motiv valid\u0000 cu NUL', REJECTION_REASON),
    ).toBe('control');
  });

  it('names a text that is empty, too short or too long', () => {
    expect(visibleTextProblem('​'.repeat(20), REJECTION_REASON)).toBe(
      'required',
    );
    expect(visibleTextProblem('ab', CATALOGUE_JOB_NAME)).toBe('min');
    expect(visibleTextProblem('a'.repeat(81), CATALOGUE_JOB_NAME)).toBe('max');
    expect(visibleTextProblem('abc', CATALOGUE_JOB_NAME)).toBeNull();
  });
});
