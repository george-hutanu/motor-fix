import { lapsesAt, moveFieldsOf, moveState } from './move-state';

const HOUR = 3_600_000;
const asked = new Date('2026-11-02T10:00:00Z');
const at = (hours: number) => new Date(asked.getTime() + hours * HOUR);
const toDo = { receivedAt: null, status: 'to_do' as const };
const booking = (extra: Partial<Parameters<typeof moveState>[0]> = {}) => ({
  moveCount: 0,
  startsAt: at(48),
  status: 'confirmed' as const,
  ...extra,
});

// @traces 184-FR-004
describe('when a move lapses, at the edges', () => {
  it('is the same instant for a booking exactly 26 hours away', () => {
    expect(lapsesAt(asked, at(26))).toEqual(at(24));
  });

  it('is a minute short of the day for a booking 25 hours 59 minutes away', () => {
    const start = new Date(at(26).getTime() - 60_000);
    expect(lapsesAt(asked, start)).toEqual(new Date(at(24).getTime() - 60_000));
  });

  it('stays a day after the ask for a booking a year away', () => {
    expect(lapsesAt(asked, at(24 * 365))).toEqual(at(24));
  });

  it('is exactly the ask time for a booking exactly two hours away', () => {
    expect(lapsesAt(asked, at(2))).toEqual(asked);
  });

  it('does not change the dates it was given', () => {
    const a = new Date(asked);
    const s = new Date(at(10));
    lapsesAt(a, s);
    expect([a, s]).toEqual([asked, at(10)]);
  });
});

// @traces 184-FR-003
// @traces 184-FR-008
describe('whether a booking can move, at the edges', () => {
  it('cannot for a count past the limit', () => {
    expect(moveState(booking({ moveCount: 3 }), toDo, null, asked)).toEqual({
      canMove: false,
      moveBlockedReason: 'limit',
    });
  });

  it('cannot for a booking that started already', () => {
    expect(
      moveState(booking({ startsAt: at(-5) }), toDo, null, asked)
        .moveBlockedReason,
    ).toBe('cutoff');
  });

  it('cannot exactly at two hours and can one millisecond before', () => {
    expect(
      moveState(booking({ startsAt: at(2) }), toDo, null, asked).canMove,
    ).toBe(false);
    expect(
      moveState(
        booking({ startsAt: new Date(at(2).getTime() + 1) }),
        toDo,
        null,
        asked,
      ).canMove,
    ).toBe(true);
  });

  it.each(['done', 'cancelled'] as const)(
    'cannot for a booking whose job is %s',
    (status) => {
      expect(
        moveState(booking(), { receivedAt: null, status }, null, asked)
          .moveBlockedReason,
      ).toBe('status');
    },
  );

  it.each(['no_show', 'completed', 'awaiting_confirmation'] as const)(
    'names status for a %s booking even with a move waiting',
    (status) => {
      expect(
        moveState(
          booking({ status }),
          null,
          { proposedBySide: 'garage', status: 'proposed' },
          asked,
        ).moveBlockedReason,
      ).toBe('status');
    },
  );

  it('answers the same twice', () => {
    const once = moveState(booking({ moveCount: 1 }), toDo, null, asked);
    expect(moveState(booking({ moveCount: 1 }), toDo, null, asked)).toEqual(
      once,
    );
  });
});

// @traces 184-FR-008
describe('the move fields of a driver read, at the edges', () => {
  it('shows a lapsed move with no reason and its decision time', () => {
    const fields = moveFieldsOf(
      booking(),
      toDo,
      {
        decidedAt: at(24),
        id: '00000000-0000-4000-8000-000000000002',
        lapsesAt: at(24),
        newStartsAt: at(50),
        proposedBySide: 'driver',
        refuseReason: null,
        status: 'lapsed',
      },
      asked,
    );
    expect(fields.move).toEqual({
      decidedAt: at(24).toISOString(),
      id: '00000000-0000-4000-8000-000000000002',
      lapsesAt: at(24).toISOString(),
      newStartsAt: at(50).toISOString(),
      proposedBySide: 'driver',
      refuseReason: null,
      status: 'lapsed',
    });
    expect(fields.canMove).toBe(true);
  });

  it('shows a waiting move with a null decision time and blocks on pending', () => {
    const fields = moveFieldsOf(
      booking(),
      toDo,
      {
        decidedAt: null,
        id: '00000000-0000-4000-8000-000000000003',
        lapsesAt: at(24),
        newStartsAt: at(50),
        proposedBySide: 'driver',
        refuseReason: null,
        status: 'proposed',
      },
      asked,
    );
    expect(fields).toMatchObject({
      canMove: false,
      move: { decidedAt: null, status: 'proposed' },
      moveBlockedReason: 'pending',
    });
  });
});
