import { noShowFlags, noShowUndoOpen } from './no-show.window';

const at = (iso: string) => new Date(iso);

// @traces 1259-FR-005
describe('the withdrawal window at its edges', () => {
  it('closes at the exact millisecond of Bucharest midnight', () => {
    const recorded = at('2026-11-10T10:00:00Z');

    expect(noShowUndoOpen(recorded, at('2026-11-10T21:59:59.999Z'))).toBe(true);
    expect(noShowUndoOpen(recorded, at('2026-11-10T22:00:00.000Z'))).toBe(
      false,
    );
  });

  it('opens a recording made at the first millisecond of the Bucharest day', () => {
    const recorded = at('2026-11-09T22:00:00.000Z');

    expect(noShowUndoOpen(recorded, at('2026-11-10T21:59:59.999Z'))).toBe(true);
    expect(noShowUndoOpen(recorded, at('2026-11-10T22:00:00.000Z'))).toBe(
      false,
    );
  });

  it('closes on the summer-time side of midnight, UTC+3', () => {
    const recorded = at('2026-07-10T10:00:00Z');

    expect(noShowUndoOpen(recorded, at('2026-07-10T20:59:59Z'))).toBe(true);
    expect(noShowUndoOpen(recorded, at('2026-07-10T21:00:00Z'))).toBe(false);
  });

  it('is closed for a year-old recording', () => {
    expect(
      noShowUndoOpen(at('2025-11-10T10:00:00Z'), at('2026-11-10T10:00:00Z')),
    ).toBe(false);
  });
});

// @traces 1259-FR-011
describe('the flags a reader gets', () => {
  const now = at('2026-11-10T10:00:00Z');
  const owner = { accountId: 'a-owner', role: 'garage' } as const;
  const base = {
    jobStatus: null,
    mechanicAccountId: 'a-fixer',
    noShowAt: null,
    startsAt: now,
    status: 'confirmed',
  };

  it('offers the no-show at the exact start instant but not a millisecond before', () => {
    expect(noShowFlags(base, owner, now).canRecordNoShow).toBe(true);
    expect(
      noShowFlags(
        { ...base, startsAt: new Date(now.getTime() + 1) },
        owner,
        now,
      ).canRecordNoShow,
    ).toBe(false);
  });

  it.each(['in_work', 'paused', 'done', 'cancelled'])(
    'does not offer the no-show over a %s job',
    (jobStatus) => {
      expect(
        noShowFlags({ ...base, jobStatus }, owner, now).canRecordNoShow,
      ).toBe(false);
    },
  );

  it('offers neither to a mechanic on a booking with no mechanic account', () => {
    const mechanic = { accountId: 'a-fixer', role: 'mechanic' } as const;
    const unowned = { ...base, mechanicAccountId: null };
    const withdrawable = {
      ...unowned,
      noShowAt: now,
      status: 'no_show',
    };

    expect(noShowFlags(unowned, mechanic, now).canRecordNoShow).toBe(false);
    expect(noShowFlags(withdrawable, mechanic, now).canWithdrawNoShow).toBe(
      false,
    );
  });

  it('offers the withdrawal of a no_show booking that has no recorded time as closed', () => {
    expect(
      noShowFlags({ ...base, status: 'no_show' }, owner, now).canWithdrawNoShow,
    ).toBe(false);
  });

  it('never offers both flags at once', () => {
    for (const status of [
      'confirmed',
      'no_show',
      'cancelled',
      'completed',
      'lapsed',
      'awaiting_confirmation',
    ]) {
      const flags = noShowFlags({ ...base, noShowAt: now, status }, owner, now);
      expect(flags.canRecordNoShow && flags.canWithdrawNoShow).toBe(false);
    }
  });
});
