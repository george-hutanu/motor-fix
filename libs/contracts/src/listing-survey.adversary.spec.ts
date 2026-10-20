import { isListingDraftData } from './listing-sections';
import {
  FEATURE_KEYS,
  isSurveySection,
  type SurveyAnswers,
  startingFeatures,
  surveyComplete,
} from './listing-survey';

const full: SurveyAnswers = {
  foundVia: 'other',
  liftsCount: '4+',
  mechanicsCount: '6+',
  wantsDaySheets: false,
  wantsLiveMedia: false,
};

// @traces 1359-FR-008
describe('isSurveySection under hostile input', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'google'],
    ['a number', 1],
    ['an array', []],
    ['an array of answers', [{ foundVia: 'google' }]],
    ['a function', () => ({})],
  ])('refuses %s', (_, value) => {
    expect(isSurveySection(value)).toBe(false);
  });

  it.each([
    ['null for a count', { mechanicsCount: null }],
    ['null for a yes', { wantsLiveMedia: null }],
    ['the number 0 for a count', { mechanicsCount: 0 }],
    ['the number 1 for a count', { liftsCount: 1 }],
    ['the text true', { wantsDaySheets: 'true' }],
    ['the number 1 for a yes', { wantsLiveMedia: 1 }],
    ['an empty text for the source', { foundVia: '' }],
    ['a code in the wrong case', { foundVia: 'Google' }],
    ['a code with a trailing space', { mechanicsCount: '1-2 ' }],
    ['an en dash for the range', { mechanicsCount: '1–2' }],
    ['an array holding a code', { foundVia: ['google'] }],
    ['a key named after an object method', { toString: 'x' }],
    ['a constructor key', { constructor: 'x' }],
    ['a feature key', { team_mechanics: true }],
    ['a key in the wrong case', { MechanicsCount: '0' }],
  ])('refuses %s', (_, value) => {
    expect(isSurveySection(value)).toBe(false);
  });

  it('refuses a parsed proto key', () => {
    expect(
      isSurveySection(JSON.parse('{"__proto__":{"foundVia":"google"}}')),
    ).toBe(false);
  });

  it('accepts the empty object and an explicit undefined answer', () => {
    expect(isSurveySection({})).toBe(true);
    expect(isSurveySection({ foundVia: undefined })).toBe(true);
  });

  it('accepts a null-prototype object', () => {
    expect(
      isSurveySection(
        Object.assign(Object.create(null), { foundVia: 'social' }),
      ),
    ).toBe(true);
  });

  it.each(['0', '6+'] as const)(
    'accepts the edge count %s',
    (mechanicsCount) => {
      expect(isSurveySection({ mechanicsCount })).toBe(true);
    },
  );
});

// @traces 1359-FR-008
describe('the draft guard on the survey section', () => {
  it.each([
    ['null', { survey: null }],
    ['an array', { survey: [] }],
    ['a text', { survey: 'google' }],
    ['a null answer', { survey: { foundVia: null } }],
  ])('refuses a draft whose survey is %s', (_, data) => {
    expect(isListingDraftData(data)).toBe(false);
  });

  it('accepts a draft with an empty survey and one with all five answers', () => {
    expect(isListingDraftData({ survey: {} })).toBe(true);
    expect(isListingDraftData({ survey: full })).toBe(true);
  });

  it('survives a JSON round trip of all five answers', () => {
    expect(
      isListingDraftData(JSON.parse(JSON.stringify({ survey: full }))),
    ).toBe(true);
  });
});

// @traces 1359-FR-006
describe('surveyComplete and startingFeatures at the edges', () => {
  it('is incomplete for an empty section and for each one missing answer', () => {
    expect(surveyComplete({})).toBe(false);
    for (const key of Object.keys(full)) {
      const partial: Record<string, unknown> = { ...full };
      delete partial[key];
      expect(surveyComplete(partial)).toBe(false);
    }
  });

  it('counts a false yes as an answer', () => {
    expect(surveyComplete(full)).toBe(true);
  });

  it('is incomplete when a key holds an explicit undefined', () => {
    expect(surveyComplete({ ...full, foundVia: undefined })).toBe(false);
  });

  it('always sets exactly the five feature keys', () => {
    expect(Object.keys(startingFeatures(full)).sort()).toEqual(
      [...FEATURE_KEYS].sort(),
    );
  });

  it('keeps the source from changing any feature', () => {
    const results = (
      ['google', 'client', 'garage', 'social', 'other'] as const
    ).map((foundVia) => startingFeatures({ ...full, foundVia }));
    for (const result of results) expect(result).toEqual(results[0]);
  });

  it('turns everything off but WhatsApp for the all-negative answers', () => {
    expect(
      startingFeatures({ ...full, liftsCount: '0', mechanicsCount: '0' }),
    ).toEqual({
      day_sheets: false,
      lift_schedule: false,
      live_media: false,
      team_mechanics: false,
      whatsapp: true,
    });
  });

  it('does not change its input and gives the same result twice', () => {
    const copy = { ...full };
    const first = startingFeatures(full);
    expect(startingFeatures(full)).toEqual(first);
    expect(full).toEqual(copy);
  });
});
