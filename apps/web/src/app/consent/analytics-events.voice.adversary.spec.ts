import { ANALYTICS_EVENTS, sanitise } from './analytics-events';

const BAD: [string, unknown][] = [
  ['zero', 0],
  ['six', 6],
  ['a decimal', 2.5],
  ['a numeric text', '3'],
  ['null', null],
  ['NaN', Number.NaN],
  ['an array', [3]],
  ['a boolean', true],
];

// @traces 009-FR-002
describe('the voice property of the analytics events', () => {
  it.each(['home_visit', 'listing_started', 'quote_request_started'])(
    'is listed on %s',
    (name) => {
      expect(Object.keys(ANALYTICS_EVENTS[name as 'home_visit'])).toContain(
        'voice',
      );
    },
  );

  it.each([1, 2, 3, 4, 5])('keeps voice %p on a Home visit', (voice) => {
    expect(sanitise('home_visit', { voice })).toEqual({ voice });
  });

  it.each(BAD)('drops %s before it leaves', (_name, voice) => {
    expect(sanitise('home_visit', { voice })).toEqual({});
    expect(sanitise('quote_request_sent', { jobs: 1, voice })).toEqual({
      jobs: 1,
    });
  });

  it('drops every other property of a Home visit', () => {
    expect(
      sanitise('home_visit', { ' voice': 3, source: 'home', voice: 2 }),
    ).toEqual({ voice: 2 });
  });

  it('does not take the prototype chain for an event', () => {
    expect(sanitise('constructor', { voice: 2 })).toBeNull();
    expect(sanitise('__proto__', { voice: 2 })).toBeNull();
  });

  it('does not carry a voice on events that were never given one', () => {
    expect(sanitise('listing_submitted', { voice: 2 })).toEqual({});
    expect(sanitise('garage_opened', { source: 'home', voice: 2 })).toEqual({
      source: 'home',
    });
  });

  it('survives a null or non-object property bag on a Home visit', () => {
    expect(sanitise('home_visit', null)).toEqual({});
    expect(sanitise('home_visit', undefined)).toEqual({});
  });
});
