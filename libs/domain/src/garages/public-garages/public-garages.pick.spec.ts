import { escaped } from './public-garages';

// @traces 062-FR-009
describe('the garage picker’s text', () => {
  it.each([
    ['Popescu', 'Popescu'],
    ['100%', '100\\%'],
    ['auto_service', 'auto\\_service'],
    ['a\\b', 'a\\\\b'],
    ['%_\\', '\\%\\_\\\\'],
  ])('matches %p literally', (q, pattern) => {
    expect(escaped(q)).toBe(pattern);
  });
});
