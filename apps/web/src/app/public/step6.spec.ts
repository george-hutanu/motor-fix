import {
  completedCount,
  cuiError,
  nameError,
  rarError,
  readStep6,
} from './step6';

describe('reading the verification step from a draft', () => {
  it('reads both values from the step-6 section', () => {
    expect(
      readStep6({ steps: { '6': { cui: '18547290', rarNumber: 'AB1' } } }),
    ).toEqual({ cui: '18547290', rarNumber: 'AB1' });
  });

  it.each([
    ['no data', {}],
    ['no section', { steps: { '1': { name: 'x' } } }],
    [
      'values that are not text',
      { steps: { '6': { cui: 1, rarNumber: null } } },
    ],
  ])('reads empty fields from %s', (_, data) => {
    expect(readStep6(data)).toEqual({ cui: '', rarNumber: '' });
  });
});

describe('the company tax ID error', () => {
  it('stays quiet until the field was left', () => {
    expect(cuiError('18547291', false)).toBeNull();
  });

  it('stays quiet for an empty field', () => {
    expect(cuiError('', true)).toBeNull();
  });

  it('names a value whose control digit is wrong once the field was left', () => {
    expect(cuiError('18547291', true)).toBe('cuiInvalid');
  });

  it('clears for a valid value', () => {
    expect(cuiError('18547290', true)).toBeNull();
  });
});

describe('the RAR number error', () => {
  it.each(['A', 'AB'])(
    'asks for at least 3 characters for %s once left',
    (v) => {
      expect(rarError(v, true)).toBe('rarShort');
      expect(rarError(v, false)).toBeNull();
    },
  );

  it.each(['', 'ABC'])('stays quiet for %p', (v) => {
    expect(rarError(v, true)).toBeNull();
  });
});

describe('the step counter', () => {
  it.each([
    [[false, false, false, false, false], 0],
    [[true, false, false, false, false], 1],
    [[true, true, false, false, false], 2],
    [[true, true, true, false, false], 3],
    [[true, true, true, true, false], 4],
    [[true, true, true, true, true], 5],
    [[false, true, false, true, false], 2],
  ])('counts %p as %i', (done, n) => {
    expect(
      completedCount(done as [boolean, boolean, boolean, boolean, boolean]),
    ).toBe(n);
  });
});

// @traces 206-FR-009
describe('the declarer name error', () => {
  it.each(['', ' ', 'I', '  I  ', 'a'.repeat(81)])(
    'asks for the full name for %p once left, when the declaration is ticked',
    (name) => {
      expect(nameError(name, true, true)).toBe('nameShort');
      expect(nameError(name, true, false)).toBeNull();
    },
  );

  it.each(['Io', ' Io ', 'Ion Popescu', 'a'.repeat(80)])(
    'stays quiet for %p',
    (name) => {
      expect(nameError(name, true, true)).toBeNull();
    },
  );

  it('stays quiet while the declaration is not ticked', () => {
    expect(nameError('I', false, true)).toBeNull();
  });
});
