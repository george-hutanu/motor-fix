import { FormControl } from '@angular/forms';

import { characters } from './characters';

describe('characters', () => {
  const check = (value: string, min = 2, max = 4, trim = false) =>
    characters(min, max, trim)(new FormControl(value));

  it('counts an emoji as one character, as the server does', () => {
    expect(check('🚗🚗')).toBeNull();
  });

  it('names what is missing, too short or too long', () => {
    expect(check('')).toEqual({ required: true });
    expect(check('a')).toEqual({
      minlength: { actualLength: 1, requiredLength: 2 },
    });
    expect(check('abcde')).toEqual({
      maxlength: { actualLength: 5, requiredLength: 4 },
    });
  });

  it('checks the trimmed value when asked', () => {
    expect(check('  a  ', 2, 4, true)).toEqual({
      minlength: { actualLength: 1, requiredLength: 2 },
    });
    expect(check('  ', 2, 4, true)).toEqual({ required: true });
  });
});
