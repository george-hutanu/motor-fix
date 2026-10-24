import { firstLine, shortName } from './reads';

// @traces 313-FR-005
describe('the first line of a description', () => {
  it.each([
    ['Scârțâie la frână\nmai ales dimineața', 'Scârțâie la frână'],
    ['Frână\r\nzgomot', 'Frână'],
    ['   Frână  \nx', 'Frână'],
    ['\n  \nScârțâie', 'Scârțâie'],
  ])('reads %j as %j', (text, line) => {
    expect(firstLine(text)).toBe(line);
  });

  it.each([null, '', '   ', '\n \r\n'])('reads %j as nothing', (text) => {
    expect(firstLine(text)).toBeNull();
  });
});

// @traces 413-FR-010
describe('a short name', () => {
  it.each([
    ['Ana Popescu', 'Ana P.'],
    ['Ana Maria Popescu', 'Ana P.'],
    ['Ana \u{1D4D0}popescu', 'Ana \u{1D4D0}.'],
    ['Ana', 'Ana'],
    ['', ''],
  ])('reads %j as %j', (name, short) => {
    expect(shortName(name)).toBe(short);
  });
});
