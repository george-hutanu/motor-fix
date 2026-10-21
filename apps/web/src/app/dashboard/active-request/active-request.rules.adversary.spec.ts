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

// Friday 9 October 2026, 13:00 in Bucharest.
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

const labels = (request: ActiveRequestDto) =>
  factsOf(request, 'ro', NOW).map((f) => f.label);

// @traces 274-FR-010
describe('the stages, taken from every side', () => {
  it('light exactly one stage, whichever it is', () => {
    for (const stage of STAGES) {
      expect(stageStates(stage).filter((s) => s === 'current')).toHaveLength(1);
      expect(stageStates(stage)).toHaveLength(5);
    }
  });

  it('never leave a grey stage before the lit one', () => {
    for (const stage of STAGES) {
      const states = stageStates(stage);
      const lit = states.indexOf('current');
      expect(states.slice(0, lit).every((s) => s === 'done')).toBe(true);
      expect(states.slice(lit + 1).every((s) => s === 'later')).toBe(true);
    }
  });

  it('answer a fresh list each call, so a caller cannot spoil the next', () => {
    const first = stageStates('booked');
    first[0] = 'later';

    expect(stageStates('booked')[0]).toBe('done');
  });
});

// @traces 274-FR-004
describe('the title from awkward requests', () => {
  it('takes the first line of a description written on Windows', () => {
    const request = activeRequest({
      description: 'Bate roata din față\r\nla viteză mare',
      jobs: [],
    });

    expect(titleOf(request, 'ro')).toBe('Bate roata din față · BMW 320d');
  });

  it('is the car alone when the description is only blank lines', () => {
    const request = activeRequest({ description: ' \n\t\n  ', jobs: [] });

    expect(titleOf(request, 'ro')).toBe('BMW 320d');
  });

  it('prefers the job types to the description', () => {
    const request = activeRequest({ description: 'Altceva' });

    expect(titleOf(request, 'en')).toBe('Front brakes · BMW 320d');
  });

  it('keeps unicode and markup in the description as plain text', () => {
    const request = activeRequest({
      description: '<b>Ștergătoare</b> 🚗 zgomot',
      jobs: [],
    });

    expect(titleOf(request, 'ro')).toBe(
      '<b>Ștergătoare</b> 🚗 zgomot · BMW 320d',
    );
  });
});

// @traces 274-FR-011
describe('who does the job, before and after', () => {
  it('is nobody for a quoted request with no booking', () => {
    expect(whoOf(activeRequest({ stage: 'quoted' }))).toBeNull();
  });

  it('is the garage alone while the booking awaits it', () => {
    expect(
      whoOf(
        activeRequest({
          booking: booking({ status: 'awaiting_confirmation' }),
          stage: 'booked',
        }),
      ),
    ).toEqual({ garage: 'Atelier Dinamo', mechanic: null });
  });
});

// @traces 274-FR-012
describe('the quoted range and the final price', () => {
  it('shows no Ofertă for a quoted request whose quotes all ended', () => {
    expect(factsOf(activeRequest({ stage: 'quoted' }), 'ro', NOW)).toEqual([]);
  });

  it('shows no Ofertă for a booking whose accepted quote is gone', () => {
    const request = activeRequest({
      booking: booking({ startsAt: '2026-10-16T06:00:00.000Z' }),
      stage: 'booked',
    });

    expect(factsOf(request, 'ro', NOW)).toEqual([
      { label: 'driver.active.fact.booked', value: 'vin., 16 oct., 09:00' },
    ]);
  });

  it('shows a final price of 0 lei once recorded on a done job', () => {
    const request = activeRequest({
      booking: booking(),
      job: job({ etaAt: null, finalPriceBani: 0, status: 'done' }),
      range: { fromBani: 89_000, toBani: 140_000 },
      stage: 'done',
    });

    expect(factsOf(request, 'ro', NOW)).toContainEqual({
      label: 'driver.active.fact.finalPrice',
      value: '0 lei',
    });
  });

  it('shows no final price on a done job before it is recorded', () => {
    const request = activeRequest({
      booking: booking(),
      job: job({ etaAt: null, status: 'done' }),
      range: { fromBani: 89_000, toBani: 140_000 },
      stage: 'done',
    });

    expect(labels(request)).not.toContain('driver.active.fact.finalPrice');
  });

  it('shows no final price while the job is still in work', () => {
    const request = activeRequest({
      booking: booking(),
      job: job({ finalPriceBani: 98_000 }),
      range: { fromBani: 89_000, toBani: 140_000 },
      stage: 'in_work',
    });

    expect(labels(request)).not.toContain('driver.active.fact.finalPrice');
  });

  it('shows a one-quote range whose ends are equal', () => {
    const request = activeRequest({
      range: { fromBani: 50_000, toBani: 50_000 },
      stage: 'quoted',
    });

    expect(factsOf(request, 'ro', NOW)[0]?.label).toBe(
      'driver.active.fact.quote',
    );
    expect(factsOf(request, 'ro', NOW)[0]?.value).toContain('500');
  });
});

// @traces 274-FR-014
describe('the start and the estimate', () => {
  it('shows neither for a booked job not yet started', () => {
    const request = activeRequest({
      booking: booking(),
      job: job({ etaAt: null, startedAt: null, status: 'to_do' }),
      stage: 'booked',
    });

    expect(labels(request)).not.toContain('driver.active.fact.started');
    expect(labels(request)).not.toContain('driver.active.fact.eta');
  });

  it('keeps the estimate while the job is paused', () => {
    const request = activeRequest({
      booking: booking(),
      job: job({ status: 'paused' }),
      stage: 'in_work',
    });

    expect(factsOf(request, 'ro', NOW)).toContainEqual({
      label: 'driver.active.fact.eta',
      value: 'azi, în jur de 12:10',
    });
  });

  it('shows an estimate that has already passed as written', () => {
    const request = activeRequest({
      booking: booking(),
      job: job({ etaAt: '2026-10-09T08:10:00.000Z' }),
      stage: 'in_work',
    });

    expect(factsOf(request, 'ro', NOW)).toContainEqual({
      label: 'driver.active.fact.eta',
      value: 'azi, în jur de 11:10',
    });
  });

  it('shows an estimate on the next Bucharest day as tomorrow', () => {
    const request = activeRequest({
      booking: booking(),
      job: job({ etaAt: '2026-10-10T05:00:00.000Z' }),
      stage: 'in_work',
    });

    expect(factsOf(request, 'en', NOW)).toContainEqual({
      label: 'driver.active.fact.eta',
      value: 'tomorrow, around 08:00',
    });
  });

  it('shows no estimate once done, even if the job still carries one', () => {
    const request = activeRequest({
      booking: booking(),
      job: job({ status: 'done' }),
      stage: 'done',
    });

    expect(labels(request)).not.toContain('driver.active.fact.eta');
  });
});

// @traces 274-FR-013
describe('the line under the facts at its limits', () => {
  it('keeps the moments-left wording once confirm-by has passed', () => {
    const request = activeRequest({
      booking: booking({
        confirmBy: '2026-10-09T09:00:00.000Z',
        status: 'awaiting_confirmation',
      }),
      stage: 'booked',
    });

    expect(lineOf(request, 'ro', NOW)).toEqual({
      key: 'driver.active.awaiting',
      params: { left: 'încă câteva secunde' },
    });
  });

  it('counts down as the clock moves', () => {
    const request = activeRequest({
      booking: booking({
        confirmBy: '2026-10-09T11:00:00.000Z',
        status: 'awaiting_confirmation',
      }),
      stage: 'booked',
    });
    const later = new Date(NOW.getTime() + 2 * 60_000);

    expect(lineOf(request, 'ro', NOW)?.params).toEqual({ left: 'încă 1 h' });
    expect(lineOf(request, 'ro', later)?.params).toEqual({
      left: 'încă 58 min',
    });
  });

  it('is none for a quoted request', () => {
    expect(
      lineOf(
        activeRequest({ range: { fromBani: 1, toBani: 2 }, stage: 'quoted' }),
        'ro',
        NOW,
      ),
    ).toBeNull();
  });
});

// @traces 274-FR-015
describe('the steps’ count at its limits', () => {
  const step = (state: 'done' | 'now' | 'todo', id: string) => ({
    id,
    state,
    text: id,
  });

  it('counts every step done', () => {
    const request = activeRequest({
      job: job({ steps: [step('done', 'a'), step('done', 'b')] }),
      stage: 'in_work',
    });

    expect(stepsSummary(request)).toEqual({ done: 2, total: 2 });
  });

  it('counts none done', () => {
    const request = activeRequest({
      job: job({ steps: [step('now', 'a'), step('todo', 'b')] }),
      stage: 'in_work',
    });

    expect(stepsSummary(request)).toEqual({ done: 0, total: 2 });
  });

  it('counts one hundred steps', () => {
    const steps = Array.from({ length: 100 }, (_, i) =>
      step(i < 37 ? 'done' : 'todo', `s${i}`),
    );
    const request = activeRequest({ job: job({ steps }), stage: 'in_work' });

    expect(stepsSummary(request)).toEqual({ done: 37, total: 100 });
  });
});

// @traces 274-FR-016
describe('the other open requests at their limits', () => {
  it.each([
    [2, 1],
    [10, 9],
    [-1, 0],
  ])('with %i open, %i more', (open, more) => {
    expect(moreOf(open)).toBe(more);
  });
});
