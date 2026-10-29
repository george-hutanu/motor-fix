// @traces 333-FR-014
import { purgedText } from './purge';

describe('purged text in Romanian', () => {
  it.each([
    [1, 90, '1 fișier șters după 90 de zile'],
    [2, 90, '2 fișiere șterse după 90 de zile'],
    [19, 1, '19 fișiere șterse după 1 zi'],
    [20, 2, '20 de fișiere șterse după 2 zile'],
    [21, 19, '21 de fișiere șterse după 19 zile'],
    [99, 20, '99 de fișiere șterse după 20 de zile'],
    [100, 100, '100 de fișiere șterse după 100 de zile'],
    [101, 101, '101 fișiere șterse după 101 zile'],
    [111, 111, '111 fișiere șterse după 111 zile'],
    [119, 119, '119 fișiere șterse după 119 zile'],
    [120, 120, '120 de fișiere șterse după 120 de zile'],
    [1000, 365, '1000 de fișiere șterse după 365 de zile'],
    [10_000, 1000, '10000 de fișiere șterse după 1000 de zile'],
  ])('%i files after %i days', (count, days, text) => {
    expect(purgedText(count, days)).toBe(text);
  });

  it('keeps the spec wording for the usual case', () => {
    expect(purgedText(5, 90)).toBe('5 fișiere șterse după 90 de zile');
  });
});
