import {
  byClosest,
  etaOf,
  isOpen,
  lastChangeOf,
  mechanicOf,
  rangeOf,
  stageOf,
  stepsOf,
} from './active-request.rules';

const at = (time: string) => new Date(`2026-10-09T${time}:00.000Z`);

type Job = Parameters<typeof etaOf>[0];

const job = (over: Partial<Job> = {}): Job => ({
  etaAt: null,
  finishedAt: null,
  handedOverAt: null,
  mechanic: null,
  pausedAt: null,
  startedAt: null,
  status: 'to_do',
  ...over,
});

const quote = (
  fromBani: number,
  toBani: number,
  status: 'waiting' | 'accepted' | 'withdrawn' | 'expired' = 'waiting',
  sentAt = at('08:00'),
) => ({ fromBani, sentAt, status, toBani });

type Row = Parameters<typeof stageOf>[0];
type Booking = Row['bookings'][number];

const booking = (over: Partial<Booking> = {}): Booking => ({
  confirmedAt: null,
  createdAt: at('09:00'),
  durationMinutes: 90,
  job: null,
  mechanic: null,
  quote: { fromBani: 45_000, toBani: 60_000 },
  status: 'awaiting_confirmation',
  ...over,
});

const row = (over: Partial<Row> = {}): Row => ({
  bookings: [],
  createdAt: at('07:00'),
  id: 'b0000000-0000-4000-8000-000000000000',
  quotes: [],
  status: 'sent',
  ...over,
});

// @traces 274-FR-003
describe('the stage of a request', () => {
  it('is sent while no quote arrived', () => {
    expect(stageOf(row())).toBe('sent');
  });

  it('is quoted once the request holds a quote', () => {
    expect(stageOf(row({ quotes: [quote(1, 2)], status: 'quoted' }))).toBe(
      'quoted',
    );
  });

  it('stays quoted when every quote has ended', () => {
    expect(
      stageOf(row({ quotes: [quote(1, 2, 'withdrawn')], status: 'quoted' })),
    ).toBe('quoted');
  });

  it.each(['awaiting_confirmation', 'confirmed'] as const)(
    'is booked with a booking %s and no job started',
    (status) => {
      expect(
        stageOf(row({ bookings: [booking({ status })], status: 'booked' })),
      ).toBe('booked');
      expect(
        stageOf(
          row({
            bookings: [booking({ job: job(), status })],
            status: 'booked',
          }),
        ),
      ).toBe('booked');
    },
  );

  it.each(['in_work', 'paused'] as const)(
    'is in work while the job is %s, whatever the request says',
    (status) => {
      expect(
        stageOf(
          row({
            bookings: [booking({ job: job({ status }), status: 'confirmed' })],
            status: 'booked',
          }),
        ),
      ).toBe('in_work');
    },
  );

  it('is done once the job is done, whatever the request says', () => {
    expect(
      stageOf(
        row({
          bookings: [
            booking({ job: job({ status: 'done' }), status: 'confirmed' }),
          ],
          status: 'booked',
        }),
      ),
    ).toBe('done');
    expect(
      stageOf(
        row({
          bookings: [
            booking({ job: job({ status: 'done' }), status: 'completed' }),
          ],
          status: 'done',
        }),
      ),
    ).toBe('done');
  });
});

// @traces 274-FR-001
describe('whether a request is open', () => {
  it.each(['sent', 'quoted'] as const)('a %s request is open', (status) => {
    expect(isOpen(row({ status }))).toBe(true);
  });

  it('a closed request is not', () => {
    expect(isOpen(row({ status: 'closed' }))).toBe(false);
  });

  it.each(['booked', 'in_work', 'done'] as const)(
    'a %s request is open while it has a live booking',
    (status) => {
      expect(isOpen(row({ bookings: [booking()], status }))).toBe(true);
      expect(isOpen(row({ status }))).toBe(false);
    },
  );

  it('a done job leaves once it is handed over', () => {
    const ready = job({ finishedAt: at('11:00'), status: 'done' });
    expect(
      isOpen(row({ bookings: [booking({ job: ready })], status: 'booked' })),
    ).toBe(true);
    expect(
      isOpen(
        row({
          bookings: [booking({ job: { ...ready, handedOverAt: at('12:00') } })],
          status: 'booked',
        }),
      ),
    ).toBe(false);
  });
});

// @traces 274-FR-002
describe('the open request closest to the workshop', () => {
  const sent = row({ id: 'a1', status: 'sent' });
  const quoted = row({ id: 'a2', quotes: [quote(1, 2)], status: 'quoted' });
  const booked = row({ bookings: [booking()], id: 'a3', status: 'booked' });
  const working = row({
    bookings: [booking({ job: job({ status: 'paused' }) })],
    id: 'a4',
    status: 'booked',
  });
  const done = row({
    bookings: [booking({ job: job({ status: 'done' }) })],
    id: 'a5',
    status: 'booked',
  });

  it('puts in work first, then booked, then waiting for quotes, then done', () => {
    const order = [done, sent, booked, working]
      .sort(byClosest)
      .map((r) => r.id);

    expect(order).toEqual(['a4', 'a3', 'a1', 'a5']);
  });

  it('ranks sent and quoted alike, the latest change first', () => {
    const older = row({ createdAt: at('06:00'), id: 'b1' });
    const newer = row({
      createdAt: at('05:00'),
      id: 'b2',
      quotes: [quote(1, 2, 'waiting', at('10:00'))],
      status: 'quoted',
    });

    expect([older, newer].sort(byClosest).map((r) => r.id)).toEqual([
      'b2',
      'b1',
    ]);
  });

  it('keeps a quoted request behind a sent one changed later', () => {
    const later = row({ createdAt: at('11:00'), id: 'a0' });

    expect([quoted, later].sort(byClosest).map((r) => r.id)).toEqual([
      'a0',
      'a2',
    ]);
  });

  it('breaks a tie of stage and change by the newest id', () => {
    const one = row({ id: 'c1' });
    const two = row({ id: 'c2' });

    expect([one, two].sort(byClosest).map((r) => r.id)).toEqual(['c2', 'c1']);
  });
});

// @traces 274-FR-002
describe('when a request last changed', () => {
  it('is its creation when nothing else happened', () => {
    expect(lastChangeOf(row())).toBe(at('07:00').getTime());
  });

  it.each([
    ['a quote sent', row({ quotes: [quote(1, 2, 'waiting', at('10:00'))] })],
    [
      'the booking made',
      row({ bookings: [booking({ createdAt: at('10:00') })] }),
    ],
    [
      'the booking confirmed',
      row({ bookings: [booking({ confirmedAt: at('10:00') })] }),
    ],
    [
      'the job started',
      row({ bookings: [booking({ job: job({ startedAt: at('10:00') }) })] }),
    ],
    [
      'the job paused',
      row({ bookings: [booking({ job: job({ pausedAt: at('10:00') }) })] }),
    ],
    [
      'the job finished',
      row({ bookings: [booking({ job: job({ finishedAt: at('10:00') }) })] }),
    ],
  ])('is %s when it is the latest', (_what, r) => {
    expect(lastChangeOf(r)).toBe(at('10:00').getTime());
  });
});

// @traces 274-FR-005
describe('the quoted range', () => {
  it('is none while there is no quote', () => {
    expect(rangeOf(row())).toBeNull();
  });

  it('spans the lowest start and the highest end of the open quotes', () => {
    const r = row({
      quotes: [
        quote(12_000, 18_000),
        quote(15_000, 26_000),
        quote(5_000, 90_000, 'withdrawn'),
      ],
      status: 'quoted',
    });

    expect(rangeOf(r)).toEqual({ fromBani: 12_000, toBani: 26_000 });
  });

  it('is none when every quote has ended', () => {
    const r = row({
      quotes: [quote(1, 2, 'expired'), quote(3, 4, 'withdrawn')],
      status: 'quoted',
    });

    expect(rangeOf(r)).toBeNull();
  });

  it('is the accepted quote’s once booked', () => {
    const r = row({
      bookings: [booking({ quote: { fromBani: 89_000, toBani: 140_000 } })],
      quotes: [quote(89_000, 140_000, 'accepted'), quote(1_000, 999_000)],
      status: 'booked',
    });

    expect(rangeOf(r)).toEqual({ fromBani: 89_000, toBani: 140_000 });
  });
});

// @traces 274-FR-007
describe('the mechanic named', () => {
  const hand = { name: 'Mihai Dumitru' };
  const costel = { name: 'Costel Radu' };

  it('is the job’s mechanic before the booking’s', () => {
    const b = booking({
      job: job({ mechanic: costel, status: 'in_work' }),
      mechanic: hand,
      status: 'confirmed',
    });

    expect(mechanicOf(b, true)).toBe('Costel Radu');
  });

  it('is the confirmed booking’s when the job names none', () => {
    expect(
      mechanicOf(booking({ mechanic: hand, status: 'confirmed' }), true),
    ).toBe('Mihai Dumitru');
    expect(
      mechanicOf(
        booking({ job: job(), mechanic: hand, status: 'confirmed' }),
        true,
      ),
    ).toBe('Mihai Dumitru');
  });

  it('is none while the booking awaits the garage', () => {
    expect(mechanicOf(booking({ mechanic: hand }), true)).toBeNull();
  });

  it('is none when the garage works without a team', () => {
    expect(
      mechanicOf(booking({ mechanic: hand, status: 'confirmed' }), false),
    ).toBeNull();
  });

  it('is none when no mechanic is set', () => {
    expect(mechanicOf(booking({ status: 'confirmed' }), true)).toBeNull();
    expect(mechanicOf(undefined, true)).toBeNull();
  });
});

// @traces 274-FR-008
describe('the estimated finish', () => {
  it('is none before the job starts', () => {
    expect(etaOf(job(), 90)).toBeNull();
  });

  it('is none once the job is done', () => {
    expect(
      etaOf(job({ startedAt: at('10:07'), status: 'done' }), 90),
    ).toBeNull();
  });

  it('is the start plus the booking’s duration, up to the next 5 minutes', () => {
    expect(
      etaOf(job({ startedAt: at('10:07'), status: 'in_work' }), 120),
    ).toEqual(at('12:10'));
  });

  it('is the garage’s own estimate when set, rounded the same way', () => {
    expect(
      etaOf(
        job({
          etaAt: new Date('2026-10-09T12:08:30.000Z'),
          startedAt: at('10:07'),
          status: 'paused',
        }),
        120,
      ),
    ).toEqual(at('12:10'));
  });

  it('keeps an exact 5-minute mark and rounds any second past it up', () => {
    const exact = job({ etaAt: at('12:10'), startedAt: at('10:00') });
    const past = job({
      etaAt: new Date('2026-10-09T12:10:01.000Z'),
      startedAt: at('10:00'),
    });

    expect(etaOf({ ...exact, status: 'in_work' }, 0)).toEqual(at('12:10'));
    expect(etaOf({ ...past, status: 'in_work' }, 0)).toEqual(at('12:15'));
  });
});

// @traces 274-FR-009
describe('the job’s steps', () => {
  const step = (
    position: number,
    done: boolean,
    customerLabel: string | null = null,
  ) => ({
    customerLabel,
    doneAt: done ? at('10:00') : null,
    id: `s${position}`,
    label: `Pas ${position}`,
    position,
  });

  it('reads them in position order in the garage’s words for the driver, else its label', () => {
    const steps = stepsOf(
      [step(2, false), step(0, true, 'Mașina pe elevator'), step(1, false)],
      'in_work',
    );

    expect(steps.map((s) => s.text)).toEqual([
      'Mașina pe elevator',
      'Pas 1',
      'Pas 2',
    ]);
    expect(steps.map((s) => s.id)).toEqual(['s0', 's1', 's2']);
  });

  it('marks the ticked ones done and the first unticked one now while in work', () => {
    const steps = stepsOf(
      [step(0, true), step(1, true), step(2, false), step(3, false)],
      'in_work',
    );

    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'now', 'todo']);
  });

  it.each(['paused', 'to_do', 'done'] as const)(
    'marks no step now while the job is %s',
    (status) => {
      expect(
        stepsOf([step(0, true), step(1, false)], status).map((s) => s.state),
      ).toEqual(['done', 'todo']);
    },
  );

  it('is empty for a job with no step', () => {
    expect(stepsOf([], 'in_work')).toEqual([]);
  });
});
