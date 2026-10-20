import {
  isSurveySection,
  type SurveyAnswers,
  startingFeatures,
  surveyComplete,
} from './listing-survey';

const base: SurveyAnswers = {
  foundVia: 'google',
  liftsCount: '1',
  mechanicsCount: '1-2',
  wantsDaySheets: true,
  wantsLiveMedia: true,
};

const allOn = {
  day_sheets: true,
  lift_schedule: true,
  live_media: true,
  team_mechanics: true,
  whatsapp: true,
};

// @traces 1359-FR-006
describe('startingFeatures', () => {
  it.each([
    ['0', false],
    ['1-2', true],
    ['3-5', true],
    ['6+', true],
  ] as const)('sets the team to %s mechanics as %s', (mechanicsCount, on) => {
    expect(startingFeatures({ ...base, mechanicsCount })).toEqual({
      ...allOn,
      team_mechanics: on,
    });
  });

  it.each([
    ['0', false],
    ['1', true],
    ['2-3', true],
    ['4+', true],
  ] as const)('sets the lift schedule for %s lifts as %s', (liftsCount, on) => {
    expect(startingFeatures({ ...base, liftsCount })).toEqual({
      ...allOn,
      lift_schedule: on,
    });
  });

  it.each([true, false])('sets live media to the answer %s', (answer) => {
    expect(startingFeatures({ ...base, wantsLiveMedia: answer })).toEqual({
      ...allOn,
      live_media: answer,
    });
  });

  it.each([true, false])('sets day sheets to the answer %s', (answer) => {
    expect(startingFeatures({ ...base, wantsDaySheets: answer })).toEqual({
      ...allOn,
      day_sheets: answer,
    });
  });

  it.each(['google', 'client', 'garage', 'social', 'other'] as const)(
    'leaves every feature as it is for the source %s',
    (foundVia) => {
      expect(startingFeatures({ ...base, foundVia })).toEqual(allOn);
    },
  );

  it('keeps WhatsApp on when every other feature is off', () => {
    expect(
      startingFeatures({
        foundVia: 'other',
        liftsCount: '0',
        mechanicsCount: '0',
        wantsDaySheets: false,
        wantsLiveMedia: false,
      }),
    ).toEqual({
      day_sheets: false,
      lift_schedule: false,
      live_media: false,
      team_mechanics: false,
      whatsapp: true,
    });
  });
});

// @traces 1359-FR-008
describe('isSurveySection', () => {
  it.each([
    ['an empty section', {}],
    ['one answer', { mechanicsCount: '6+' }],
    ['two answers', { liftsCount: '4+', mechanicsCount: '0' }],
    ['five answers', base],
  ])('accepts %s', (_, value) => {
    expect(isSurveySection(value)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a list', []],
    ['text', 'google'],
    ['an unknown key', { ...base, budget: 'high' }],
    ['a count that is a number', { mechanicsCount: 2 }],
    ['a count outside the bands', { mechanicsCount: '2' }],
    ['a lift band of the mechanics', { liftsCount: '1-2' }],
    ['a yes that is text', { wantsLiveMedia: 'true' }],
    ['a day sheet answer that is null', { wantsDaySheets: null }],
    ['an unknown source', { foundVia: 'radio' }],
  ])('refuses %s', (_, value) => {
    expect(isSurveySection(value)).toBe(false);
  });
});

describe('surveyComplete', () => {
  it('is true with all five answers', () => {
    expect(surveyComplete(base)).toBe(true);
  });

  it('is true when both yes or no answers are no', () => {
    expect(
      surveyComplete({ ...base, wantsDaySheets: false, wantsLiveMedia: false }),
    ).toBe(true);
  });

  it.each([
    'mechanicsCount',
    'liftsCount',
    'wantsLiveMedia',
    'wantsDaySheets',
    'foundVia',
  ] as const)('is false without %s', (key) => {
    const { [key]: _, ...rest } = base;
    expect(surveyComplete(rest)).toBe(false);
  });
});
