import { lapsesAt, moveFieldsOf, moveState } from './move-state';

const HOUR = 3_600_000;
const asked = new Date('2026-11-02T10:00:00Z');
const at = (hours: number) => new Date(asked.getTime() + hours * HOUR);

// @traces 184-FR-004
describe('when a move lapses', () => {
  it('is a day after the ask for a booking three days away', () => {
    expect(lapsesAt(asked, at(72))).toEqual(at(24));
  });

  it('is two hours before the booking when that comes first', () => {
    expect(lapsesAt(asked, at(26))).toEqual(at(24));
    expect(lapsesAt(asked, at(25))).toEqual(at(23));
    expect(lapsesAt(asked, at(10))).toEqual(at(8));
  });
});

const booking = (extra: Partial<Parameters<typeof moveState>[0]> = {}) => ({
  moveCount: 0,
  startsAt: at(48),
  status: 'confirmed' as const,
  ...extra,
});
const toDo = { receivedAt: null, status: 'to_do' as const };

// @traces 184-FR-003
// @traces 184-FR-008
describe('whether a booking can move', () => {
  it('can when confirmed, ahead, under the limit and with nothing waiting', () => {
    expect(moveState(booking(), toDo, null, asked)).toEqual({
      canMove: true,
      moveBlockedReason: null,
    });
    expect(moveState(booking({ moveCount: 1 }), null, null, asked)).toEqual({
      canMove: true,
      moveBlockedReason: null,
    });
  });

  it.each([
    ['cancelled', booking({ status: 'cancelled' }), toDo],
    ['completed', booking({ status: 'completed' }), toDo],
    ['started', booking(), { receivedAt: null, status: 'in_work' as const }],
    ['received', booking(), { receivedAt: at(-1), status: 'to_do' as const }],
  ])('cannot once %s, for its status', (_name, row, job) => {
    expect(moveState(row, job, null, asked)).toEqual({
      canMove: false,
      moveBlockedReason: 'status',
    });
  });

  it('cannot within two hours of the start', () => {
    const row = booking({ startsAt: at(2) });
    expect(moveState(row, toDo, null, asked).moveBlockedReason).toBe('cutoff');
    const earlier = booking({ startsAt: new Date(at(2).getTime() + 60_000) });
    expect(moveState(earlier, toDo, null, asked).canMove).toBe(true);
  });

  it('cannot after two moves', () => {
    expect(
      moveState(booking({ moveCount: 2 }), toDo, null, asked).moveBlockedReason,
    ).toBe('limit');
  });

  it('cannot while a move of either side waits', () => {
    for (const side of ['driver', 'garage'] as const) {
      const move = { proposedBySide: side, status: 'proposed' as const };
      expect(moveState(booking(), toDo, move, asked).moveBlockedReason).toBe(
        'pending',
      );
    }
  });

  it('can again once the last move is decided', () => {
    for (const status of [
      'accepted',
      'refused',
      'lapsed',
      'cancelled',
    ] as const) {
      const move = { proposedBySide: 'driver' as const, status };
      expect(
        moveState(booking({ moveCount: 1 }), toDo, move, asked).canMove,
      ).toBe(true);
    }
  });

  it('names the first reason that applies', () => {
    const waiting = {
      proposedBySide: 'driver' as const,
      status: 'proposed' as const,
    };
    const all = booking({ moveCount: 2, startsAt: at(1), status: 'cancelled' });
    expect(moveState(all, toDo, waiting, asked).moveBlockedReason).toBe(
      'status',
    );
    const late = booking({ moveCount: 2, startsAt: at(1) });
    expect(moveState(late, toDo, waiting, asked).moveBlockedReason).toBe(
      'cutoff',
    );
    const full = booking({ moveCount: 2 });
    expect(moveState(full, toDo, waiting, asked).moveBlockedReason).toBe(
      'limit',
    );
  });
});

// @traces 184-FR-008
// @traces 184-FR-001
describe('the move fields a driver reads', () => {
  const move = {
    createdAt: asked,
    decidedAt: at(3),
    id: '00000000-0000-4000-8000-000000000001',
    lapsesAt: at(24),
    newStartsAt: at(50),
    proposedBySide: 'garage' as const,
    refuseReason: 'parts_not_available' as const,
    status: 'refused' as const,
  };

  it('shows the latest move whatever its status, with its reason', () => {
    expect(moveFieldsOf(booking({ moveCount: 1 }), toDo, move, asked)).toEqual({
      canMove: true,
      move: {
        decidedAt: at(3).toISOString(),
        id: move.id,
        lapsesAt: at(24).toISOString(),
        newStartsAt: at(50).toISOString(),
        proposedBySide: 'garage',
        refuseReason: 'parts_not_available',
        status: 'refused',
      },
      moveBlockedReason: null,
      moveCount: 1,
    });
  });

  it('shows no move when there was none', () => {
    expect(moveFieldsOf(booking(), toDo, null, asked)).toEqual({
      canMove: true,
      move: null,
      moveBlockedReason: null,
      moveCount: 0,
    });
  });
});
