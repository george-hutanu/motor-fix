import { plainText } from './plain-text';

describe('plainText', () => {
  it('keeps a string as it is', () => {
    expect(plainText(' Frâne ')).toBe(' Frâne ');
  });

  it.each([undefined, null, 7, ['a'], {}, 'Spă\u0000lare'])(
    'reads %j as no text',
    (value) => {
      expect(plainText(value)).toBe('');
    },
  );
});
