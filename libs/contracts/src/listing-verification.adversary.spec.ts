import { isListingDraftData } from './listing-drafts.dto';
import {
  isStep6Section,
  isValidCui,
  normaliseRarNumber,
  RAR_NUMBER_MIN,
  STEP6_VALUE_MAX,
  stripCui,
} from './listing-verification';

describe('stripping a typed company tax ID', () => {
  it('removes every kind of whitespace, not only spaces', () => {
    expect(stripCui('\t18\n547 290\r')).toBe('18547290');
  });

  it('removes only one leading prefix', () => {
    expect(stripCui('RORO18547290')).toBe('RO18547290');
  });

  it('keeps an RO that is not leading', () => {
    expect(stripCui('18547290RO')).toBe('18547290RO');
  });

  it('strips a mixed-case prefix', () => {
    expect(stripCui('rO18547290')).toBe('18547290');
    expect(stripCui('Ro 18547290')).toBe('18547290');
  });

  it('reads an empty string as empty', () => {
    expect(stripCui('')).toBe('');
    expect(stripCui('   \t ')).toBe('');
  });

  it('is idempotent', () => {
    for (const typed of ['ro 18 547 290', 'RO', 'x y']) {
      expect(stripCui(stripCui(typed))).toBe(stripCui(typed));
    }
  });

  it('does not drop a Cyrillic or fullwidth lookalike prefix', () => {
    expect(stripCui('РО18547290')).toBe('РО18547290');
    expect(stripCui('ＲＯ18547290')).toBe('ＲＯ18547290');
  });

  it('handles ten thousand characters without losing the digits', () => {
    expect(stripCui(` ${'1'.repeat(10_000)} `)).toBe('1'.repeat(10_000));
  });
});

describe('the control digit of a company tax ID at the edges', () => {
  it.each(['18547290', '60', '00', '0000000000', '1234567897'])(
    'accepts %s',
    (cui) => {
      expect(isValidCui(cui)).toBe(true);
    },
  );

  it('reads a control of ten as zero', () => {
    expect(isValidCui('60')).toBe(true);
    expect(isValidCui('69')).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['one digit', '1'],
    ['eleven digits', '12345678901'],
    ['a prefix still on', 'RO18547290'],
    ['a space inside', '18 547 290'],
    ['a trailing newline', '18547290\n'],
    ['a leading space', ' 18547290'],
    ['an Arabic-Indic digit', '1854729٠'],
    ['a fullwidth digit', '１８５４７２９０'],
    ['a minus sign', '-18547290'],
    ['a decimal point', '1854729.0'],
    ['an exponent', '1e7'],
  ])('rejects %s', (_, cui) => {
    expect(isValidCui(cui)).toBe(false);
  });

  it('accepts a ten-digit tax ID and rejects it with a wrong last digit', () => {
    expect(isValidCui('1234567897')).toBe(true);
    expect(isValidCui('1234567890')).toBe(false);
  });

  it('rejects every wrong control digit of a nine-digit base', () => {
    const wrong = [0, 1, 2, 3, 4, 5, 6, 8, 9].map((d) => `123456789${d}`);
    expect(wrong.map(isValidCui)).toEqual(wrong.map(() => false));
    expect(isValidCui('1234567897')).toBe(true);
  });

  it('answers the same for the same input called twice', () => {
    expect(isValidCui('18547290')).toBe(isValidCui('18547290'));
    expect(isValidCui('18547291')).toBe(isValidCui('18547291'));
  });
});

describe('normalising a typed RAR number', () => {
  it('trims all whitespace kinds before the capitals', () => {
    expect(normaliseRarNumber('\t\n rar-123  ')).toBe('RAR-123');
  });

  it('keeps inner whitespace and punctuation as typed', () => {
    expect(normaliseRarNumber(' ab  c/12 ')).toBe('AB  C/12');
  });

  it('cuts at exactly forty characters', () => {
    expect(normaliseRarNumber('a'.repeat(40))).toBe('A'.repeat(40));
    expect(normaliseRarNumber('a'.repeat(41))).toBe('A'.repeat(40));
    expect(normaliseRarNumber('a'.repeat(39))).toBe('A'.repeat(39));
  });

  it('trims before cutting, so leading spaces do not eat the budget', () => {
    expect(normaliseRarNumber(`${' '.repeat(10)}${'b'.repeat(45)}`)).toBe(
      'B'.repeat(40),
    );
  });

  it('reads blank input as empty', () => {
    expect(normaliseRarNumber('')).toBe('');
    expect(normaliseRarNumber(' \t\n ')).toBe('');
  });

  it('is idempotent', () => {
    const once = normaliseRarNumber('  ab-12 c ');
    expect(normaliseRarNumber(once)).toBe(once);
  });

  it('upper-cases Romanian letters', () => {
    expect(normaliseRarNumber('ăâîșț')).toBe('ĂÂÎȘȚ');
  });
});

describe('the constants', () => {
  it('fixes the minimum and the cap', () => {
    expect(RAR_NUMBER_MIN).toBe(3);
    expect(STEP6_VALUE_MAX).toBe(40);
  });
});

describe('the step-6 section as the server sees it', () => {
  it.each([
    ['empty', {}],
    ['only a tax ID', { cui: '18547290' }],
    ['only a RAR number', { rarNumber: 'RAR-123' }],
    ['both', { cui: '18547290', rarNumber: 'RAR-123' }],
    ['empty strings', { cui: '', rarNumber: '' }],
    ['a wrong control digit', { cui: '18547291' }],
    ['a two-character RAR number', { rarNumber: 'AB' }],
    [
      'exactly forty characters',
      { cui: '1'.repeat(40), rarNumber: 'A'.repeat(40) },
    ],
  ])('accepts %s', (_, section) => {
    expect(isStep6Section(section)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['an array holding a section', [{ cui: '1' }]],
    ['a string', 'cui'],
    ['a number', 6],
    ['an unknown key', { caen: '4520' }],
    ['an unknown key beside a good one', { caen: '4520', cui: '18547290' }],
    ['a number as the tax ID', { cui: 18547290 }],
    ['null as the tax ID', { cui: null }],
    ['undefined-valued unknown key', { other: undefined }],
    ['an array as the RAR number', { rarNumber: ['A'] }],
    ['an object as the RAR number', { rarNumber: { v: 'A' } }],
    ['a boolean', { cui: true }],
    ['forty-one characters of tax ID', { cui: '1'.repeat(41) }],
    ['forty-one characters of RAR number', { rarNumber: 'A'.repeat(41) }],
    ['forty-one multi-byte characters', { rarNumber: 'ș'.repeat(41) }],
  ])('rejects %s', (_, section) => {
    expect(isStep6Section(section)).toBe(false);
  });

  it('rejects a null-prototype object carrying an unknown key', () => {
    const section = Object.assign(Object.create(null), { cui: '1', x: '2' });
    expect(isStep6Section(section)).toBe(false);
  });

  it('accepts a null-prototype object carrying known keys', () => {
    const section = Object.assign(Object.create(null), { cui: '18547290' });
    expect(isStep6Section(section)).toBe(true);
  });
});

describe('a draft carrying a step-6 section', () => {
  const draft = (six: unknown) => ({ steps: { '6': six } });

  it('accepts both values', () => {
    expect(
      isListingDraftData(draft({ cui: '18547290', rarNumber: 'RAR-123' })),
    ).toBe(true);
  });

  it.each([{}, { steps: {} }, { steps: { '6': {} } }])(
    'accepts %p without values',
    (data) => {
      expect(isListingDraftData(data)).toBe(true);
    },
  );

  it('accepts a wrong control digit and a short RAR number', () => {
    expect(isListingDraftData(draft({ cui: '18547291' }))).toBe(true);
    expect(isListingDraftData(draft({ rarNumber: 'AB' }))).toBe(true);
  });

  it.each([
    ['an unknown key', { caen: '4520' }],
    ['a numeric tax ID', { cui: 18547290 }],
    ['a forty-one character RAR number', { rarNumber: 'A'.repeat(41) }],
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
  ])('refuses %s', (_, six) => {
    expect(isListingDraftData(draft(six))).toBe(false);
  });

  it('still refuses an unknown key outside steps', () => {
    expect(isListingDraftData({ other: 1, steps: { '6': {} } })).toBe(false);
  });

  it('judges another step as before', () => {
    expect(isListingDraftData({ steps: { '1': { anything: 1 } } })).toBe(true);
  });

  it('does not let a good step 6 excuse a bad one elsewhere', () => {
    expect(
      isListingDraftData({
        steps: { '6': { cui: '18547290' }, '99': { a: 1 } },
      }),
    ).toBe(false);
  });
});
