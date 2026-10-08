import { dueStage, type ReminderState } from './reminders';

const itp = (
  dueOn: string,
  flags: Partial<ReminderState> = {},
): ReminderState => ({
  dueOn,
  kind: 'itp',
  seasonYear: null,
  sent7: false,
  sent30: false,
  sentAt: null,
  ...flags,
});

describe('when a 30 and 7 day reminder is due', () => {
  it('sends the 30-day reminder 30 days before', () => {
    expect(dueStage(itp('2026-12-10'), '2026-11-10')).toEqual({
      stage: '30',
      type: 'DUE_ITP',
    });
  });

  it('sends nothing 31 days before', () => {
    expect(dueStage(itp('2026-12-10'), '2026-11-09')).toBeNull();
  });

  it('sends the 30-day reminder once', () => {
    expect(
      dueStage(itp('2026-12-10', { sent30: true }), '2026-11-11'),
    ).toBeNull();
  });

  it('catches a missed 30-day run on a later day of its window', () => {
    expect(dueStage(itp('2026-12-10'), '2026-12-02')).toEqual({
      stage: '30',
      type: 'DUE_ITP',
    });
  });

  it('sends the 7-day reminder 7 days before, once', () => {
    expect(dueStage(itp('2026-12-10', { sent30: true }), '2026-12-03')).toEqual(
      { stage: '7', type: 'DUE_ITP' },
    );
    expect(
      dueStage(itp('2026-12-10', { sent7: true, sent30: true }), '2026-12-04'),
    ).toBeNull();
  });

  it('sends only the 7-day reminder for a date 5 days away', () => {
    expect(dueStage(itp('2026-12-10'), '2026-12-05')).toEqual({
      stage: '7',
      type: 'DUE_ITP',
    });
  });

  it('still sends the 7-day reminder on the due day itself', () => {
    expect(dueStage(itp('2026-12-10', { sent30: true }), '2026-12-10')).toEqual(
      { stage: '7', type: 'DUE_ITP' },
    );
  });

  it('sends nothing for a date already past', () => {
    expect(dueStage(itp('2026-12-10'), '2026-12-11')).toBeNull();
  });

  it('names each kind its own type', () => {
    for (const [kind, type] of [
      ['rca', 'DUE_RCA'],
      ['rovinieta', 'DUE_ROVINIETA'],
      ['service', 'SERVICE_DUE'],
    ] as const) {
      expect(dueStage({ ...itp('2026-12-10'), kind }, '2026-11-10')).toEqual({
        stage: '30',
        type,
      });
    }
  });
});

describe('when a tyre reminder is due', () => {
  const tyres = (
    kind: 'tyres_winter' | 'tyres_summer',
    seasonYear: number | null = null,
  ): ReminderState => ({
    dueOn: null,
    kind,
    seasonYear,
    sent7: false,
    sent30: false,
    sentAt: null,
  });

  it('sends the winter reminder on 1 November', () => {
    expect(dueStage(tyres('tyres_winter'), '2026-11-01')).toEqual({
      stage: 'season',
      type: 'TYRES_SEASON',
    });
  });

  it('sends the winter reminder once a season', () => {
    expect(dueStage(tyres('tyres_winter', 2026), '2026-11-02')).toBeNull();
    expect(dueStage(tyres('tyres_winter', 2025), '2026-11-01')).toEqual({
      stage: 'season',
      type: 'TYRES_SEASON',
    });
  });

  it('sends the summer reminder on 1 April, not in November', () => {
    expect(dueStage(tyres('tyres_summer'), '2026-11-01')).toBeNull();
    expect(dueStage(tyres('tyres_summer'), '2027-04-01')).toEqual({
      stage: 'season',
      type: 'TYRES_SEASON',
    });
  });

  it('sends no tyre reminder in another month', () => {
    expect(dueStage(tyres('tyres_winter'), '2026-10-31')).toBeNull();
    expect(dueStage(tyres('tyres_winter'), '2026-12-01')).toBeNull();
  });
});

describe('when a booking reminder is due', () => {
  const booking = (
    dueOn: string,
    sentAt: Date | null = null,
  ): ReminderState => ({
    dueOn,
    kind: 'booking',
    seasonYear: null,
    sent7: false,
    sent30: false,
    sentAt,
  });

  it('sends it the day before the booking', () => {
    expect(dueStage(booking('2026-11-11'), '2026-11-10')).toEqual({
      stage: 'day_before',
      type: 'BOOKING_REMINDER',
    });
  });

  it('sends it once', () => {
    expect(
      dueStage(
        booking('2026-11-11', new Date('2026-11-10T07:00:00Z')),
        '2026-11-10',
      ),
    ).toBeNull();
  });

  it('sends nothing two days before or on the day', () => {
    expect(dueStage(booking('2026-11-12'), '2026-11-10')).toBeNull();
    expect(dueStage(booking('2026-11-10'), '2026-11-10')).toBeNull();
  });
});
