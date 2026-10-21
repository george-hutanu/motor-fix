import type { ActiveRequestDto } from '@motor-fix/data-access';

import {
  factsOf,
  lineOf,
  moreOf,
  STAGES,
  stageStates,
  stepsSummary,
  titleOf,
  whoOf,
} from './active-request.rules';

// 13:00 in Bucharest, a Friday.
const NOW = new Date('2026-10-09T10:00:00.000Z');

const brakes = {
  id: 'j1',
  jobTypeId: 't1',
  nameEn: 'Front brakes',
  nameRo: 'Frâne față',
  position: 0,
};

const activeRequest = (
  over: Partial<ActiveRequestDto> = {},
): ActiveRequestDto => ({
  booking: null,
  car: { brand: 'BMW', model: '320d', year: 2016 },
  description: null,
  id: 'r1',
  job: null,
  jobs: [brakes],
  mechanicName: null,
  range: null,
  stage: 'sent',
  ...over,
});

const booking = (
  over: Partial<NonNullable<ActiveRequestDto['booking']>> = {},
): NonNullable<ActiveRequestDto['booking']> => ({
  confirmBy: '2026-10-10T04:00:00.000Z',
  garage: { id: 'g1', name: 'Atelier Dinamo', slug: 'atelier-dinamo' },
  startsAt: '2026-10-09T06:00:00.000Z',
  status: 'confirmed',
  ...over,
});

const job = (
  over: Partial<NonNullable<ActiveRequestDto['job']>> = {},
): NonNullable<ActiveRequestDto['job']> => ({
  etaAt: '2026-10-09T09:10:00.000Z',
  finalPriceBani: null,
  startedAt: '2026-10-09T07:07:00.000Z',
  status: 'in_work',
  steps: [],
  ...over,
});

// @traces 274-request-stages-FR-010
describe('the five stages', () => {
  it('are sent, quoted, booked, in work and done, in that order', () => {
    expect(STAGES).toEqual(['sent', 'quoted', 'booked', 'in_work', 'done']);
  });

  it.each([
    ['sent', ['current', 'later', 'later', 'later', 'later']],
    ['quoted', ['done', 'current', 'later', 'later', 'later']],
    ['booked', ['done', 'done', 'current', 'later', 'later']],
    ['in_work', ['done', 'done', 'done', 'current', 'later']],
    ['done', ['done', 'done', 'done', 'done', 'current']],
  ] as const)('fill the ones before %s and light it', (stage, states) => {
    expect(stageStates(stage)).toEqual(states);
  });
});

// @traces 274-request-stages-FR-004
describe('the title', () => {
  it('names the jobs and the car in the reader’s language', () => {
    const request = activeRequest({
      jobs: [brakes, { ...brakes, nameEn: 'Oil', nameRo: 'Ulei', position: 1 }],
    });

    expect(titleOf(request, 'ro')).toBe('Frâne față, Ulei · BMW 320d');
    expect(titleOf(request, 'en')).toBe('Front brakes, Oil · BMW 320d');
  });

  it('falls back to the description’s first line with no job', () => {
    const request = activeRequest({
      description: '\n Scârțâie la frânare\nmai ales dimineața',
      jobs: [],
    });

    expect(titleOf(request, 'ro')).toBe('Scârțâie la frânare · BMW 320d');
  });

  it('is the car alone with neither', () => {
    expect(titleOf(activeRequest({ jobs: [] }), 'ro')).toBe('BMW 320d');
  });
});

// @traces 274-request-stages-FR-011
describe('who does the job', () => {
  it('is nobody before booking', () => {
    expect(whoOf(activeRequest())).toBeNull();
  });

  it('is the garage, and its mechanic when named', () => {
    expect(
      whoOf(activeRequest({ booking: booking(), stage: 'booked' })),
    ).toEqual({
      garage: 'Atelier Dinamo',
      mechanic: null,
    });
    expect(
      whoOf(
        activeRequest({
          booking: booking(),
          mechanicName: 'Costel Radu',
          stage: 'in_work',
        }),
      ),
    ).toEqual({ garage: 'Atelier Dinamo', mechanic: 'Costel Radu' });
  });
});

// @traces 274-request-stages-FR-012
// @traces 274-request-stages-FR-013
// @traces 274-request-stages-FR-014
describe('the facts', () => {
  it('shows nothing for a sent request', () => {
    expect(factsOf(activeRequest(), 'ro', NOW)).toEqual([]);
  });

  it('shows the quoted range in lei', () => {
    const request = activeRequest({
      range: { fromBani: 12_000, toBani: 26_000 },
      stage: 'quoted',
    });

    expect(factsOf(request, 'ro', NOW)).toEqual([
      { label: 'driver.active.fact.quote', value: '120–260 lei' },
    ]);
  });

  it('shows the booking’s day and time once confirmed, before the start', () => {
    const request = activeRequest({
      booking: booking({ startsAt: '2026-10-16T06:00:00.000Z' }),
      range: { fromBani: 12_000, toBani: 26_000 },
      stage: 'booked',
    });

    expect(factsOf(request, 'ro', NOW)).toEqual([
      { label: 'driver.active.fact.quote', value: '120–260 lei' },
      { label: 'driver.active.fact.booked', value: 'vin., 16 oct., 09:00' },
    ]);
  });

  it('shows no booking time while the garage has not confirmed', () => {
    const request = activeRequest({
      booking: booking({ status: 'awaiting_confirmation' }),
      stage: 'booked',
    });

    expect(factsOf(request, 'ro', NOW)).toEqual([]);
  });

  it('shows the start and the estimate in work', () => {
    const request = activeRequest({
      booking: booking(),
      job: job(),
      range: { fromBani: 89_000, toBani: 140_000 },
      stage: 'in_work',
    });

    expect(factsOf(request, 'ro', NOW)).toEqual([
      { label: 'driver.active.fact.quote', value: '890–1.400 lei' },
      { label: 'driver.active.fact.started', value: 'azi, 10:07' },
      { label: 'driver.active.fact.eta', value: 'azi, în jur de 12:10' },
    ]);
    expect(factsOf(request, 'en', NOW)[2]).toEqual({
      label: 'driver.active.fact.eta',
      value: 'today, around 12:10',
    });
  });

  it('shows the final price next to the range and no estimate when done', () => {
    const request = activeRequest({
      booking: booking(),
      job: job({ etaAt: null, finalPriceBani: 98_000, status: 'done' }),
      range: { fromBani: 89_000, toBani: 140_000 },
      stage: 'done',
    });

    expect(factsOf(request, 'ro', NOW)).toEqual([
      { label: 'driver.active.fact.quote', value: '890–1.400 lei' },
      { label: 'driver.active.fact.finalPrice', value: '980 lei' },
      { label: 'driver.active.fact.started', value: 'azi, 10:07' },
    ]);
  });
});

// @traces 274-request-stages-FR-013
// @traces 274-request-stages-FR-014
describe('the line under the facts', () => {
  it('is none while waiting for quotes', () => {
    expect(lineOf(activeRequest(), 'ro', NOW)).toBeNull();
  });

  it('says the garage has yet to confirm, with the time left', () => {
    const request = activeRequest({
      booking: booking({
        confirmBy: '2026-10-10T04:00:00.000Z',
        status: 'awaiting_confirmation',
      }),
      stage: 'booked',
    });

    expect(lineOf(request, 'ro', NOW)).toEqual({
      key: 'driver.active.awaiting',
      params: { left: 'încă 18 h' },
    });
    expect(lineOf(request, 'en', NOW)?.params).toEqual({ left: '18 h left' });
  });

  it('says the job is paused', () => {
    const request = activeRequest({
      booking: booking(),
      job: job({ status: 'paused' }),
      stage: 'in_work',
    });

    expect(lineOf(request, 'ro', NOW)).toEqual({ key: 'driver.active.paused' });
  });

  it('says the car is ready when done', () => {
    const request = activeRequest({
      booking: booking(),
      job: job({ status: 'done' }),
      stage: 'done',
    });

    expect(lineOf(request, 'ro', NOW)).toEqual({ key: 'driver.active.ready' });
  });

  it('is none in work or confirmed', () => {
    expect(
      lineOf(
        activeRequest({ booking: booking(), job: job(), stage: 'in_work' }),
        'ro',
        NOW,
      ),
    ).toBeNull();
    expect(
      lineOf(activeRequest({ booking: booking(), stage: 'booked' }), 'ro', NOW),
    ).toBeNull();
  });
});

// @traces 274-request-stages-FR-015
describe('the steps’ count', () => {
  const step = (state: 'done' | 'now' | 'todo', id: string) => ({
    id,
    state,
    text: id,
  });

  it('counts the done ones of all', () => {
    const request = activeRequest({
      job: job({
        steps: [
          step('done', 'a'),
          step('done', 'b'),
          step('now', 'c'),
          step('todo', 'd'),
          step('todo', 'e'),
        ],
      }),
      stage: 'in_work',
    });

    expect(stepsSummary(request)).toEqual({ done: 2, total: 5 });
  });

  it('is none with no job or no step', () => {
    expect(stepsSummary(activeRequest())).toBeNull();
    expect(
      stepsSummary(activeRequest({ job: job(), stage: 'in_work' })),
    ).toBeNull();
  });
});

// @traces 274-request-stages-FR-016
describe('the other open requests', () => {
  it.each([
    [0, 0],
    [1, 0],
    [3, 2],
  ])('with %i open, %i more', (open, more) => {
    expect(moreOf(open)).toBe(more);
  });
});
