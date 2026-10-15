import { sanitise } from './analytics-events';

// @traces 250-FR-002
describe('the event sanitiser against hostile input', () => {
  it('sends nothing for names that exist on every object', () => {
    for (const name of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      'valueOf',
      '',
      ' brand_picked',
      'Brand_Picked',
      'brand_picked ',
    ])
      expect(sanitise(name, {})).toBeNull();
  });

  it('drops property names that exist on every object', () => {
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"constructor":"x","toString":"y","source":"profile"}',
    );

    const kept = sanitise('quote_request_started', hostile);

    expect(kept).toEqual({ source: 'profile' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('drops brands that are not lowercase letters, digits and single hyphens', () => {
    for (const brand of [
      '',
      'Dacia',
      'dacia-',
      '-dacia',
      'da--cia',
      'dacia\n',
      ' dacia',
      'dacia ',
      'dăcia',
      'dacia_x',
      'a/b',
      'пежо',
      'a'.repeat(81),
      5,
      null,
      undefined,
      ['dacia'],
      { toString: () => 'dacia' },
    ])
      expect(sanitise('brand_picked', { brand })).toEqual({});
  });

  it('keeps a brand of one character, of 80, and with digits and hyphens', () => {
    for (const brand of ['a', 'a'.repeat(80), 'ds-3', '9', 'mercedes-benz'])
      expect(sanitise('brand_picked', { brand })).toEqual({ brand });
  });

  it('drops job counts and positions that are not whole numbers from 1', () => {
    for (const jobs of [
      0,
      -1,
      1.5,
      0.999,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      1e21,
      '1',
      '',
      true,
      null,
      [1],
    ])
      expect(sanitise('quote_request_sent', { jobs })).toEqual({});
    for (const position of [0, -3, 2.5, '2', Number.NaN])
      expect(sanitise('quote_accepted', { position })).toEqual({});
  });

  it('drops steps and ratings one past their ends and as text', () => {
    for (const step of [0, 7, -1, 3.5, '3', Number.NaN])
      expect(sanitise('listing_step_completed', { step })).toEqual({});
    for (const rating of [0, 6, 4.5, '5', null])
      expect(sanitise('review_posted', { rating })).toEqual({});
    expect(sanitise('listing_step_completed', { step: 6 })).toEqual({
      step: 6,
    });
    expect(sanitise('listing_step_completed', { step: 1 })).toEqual({
      step: 1,
    });
    expect(sanitise('review_posted', { rating: 5 })).toEqual({ rating: 5 });
    expect(sanitise('review_posted', { rating: 1 })).toEqual({ rating: 1 });
  });

  it('drops garage buckets written with a hyphen, a number or spaces', () => {
    for (const garages of ['2-3', '4-5', 1, 2, '2–3 ', ' 1', '6', '0', '1–1'])
      expect(sanitise('quote_request_sent', { garages })).toEqual({});
  });

  it('drops an enum value given as a number, an array or the wrong case', () => {
    for (const source of [1, ['profile'], 'Profile', 'profile ', null, {}])
      expect(sanitise('quote_request_started', { source })).toEqual({});
  });

  it('drops a property whose name differs only by case, space or a look-alike letter', () => {
    expect(
      sanitise('quote_request_started', {
        Source: 'profile',
        'source ': 'profile',
        sоurce: 'profile',
      }),
    ).toEqual({});
  });

  it('gives an event without properties an empty object whatever was passed', () => {
    expect(
      sanitise('listing_started', { email: 'a@b.ro', plate: 'B123ABC' }),
    ).toEqual({});
    expect(sanitise('survey_completed', { step: 1 })).toEqual({});
  });

  it('leaves its input untouched and returns a new object', () => {
    const input = { brand: 'dacia', garage: 'x', source: 'home_picker' };
    const copy = { ...input };

    const kept = sanitise('brand_picked', input);

    expect(input).toEqual(copy);
    expect(kept).not.toBe(input);
  });

  it('holds the same answer when asked twice', () => {
    const props = { garages: '2–3', jobs: 2, note: 'free text' };
    expect(sanitise('quote_request_sent', props)).toEqual(
      sanitise('quote_request_sent', props),
    );
    expect(sanitise('quote_request_sent', props)).toEqual({
      garages: '2–3',
      jobs: 2,
    });
  });

  it('carries no email-like or id-like value through any allowed property', () => {
    const kept = sanitise('brand_picked', {
      brand: 'ion.popescu@example.ro',
      source: '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c',
    });
    expect(kept).toEqual({});
  });

  it('copes with ten thousand properties', () => {
    const props: Record<string, unknown> = { source: 'profile' };
    for (let i = 0; i < 10_000; i++) props[`k${i}`] = i;

    expect(sanitise('quote_request_started', props)).toEqual({
      source: 'profile',
    });
  });
});
