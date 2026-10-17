import { firstLine } from './reads';

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
