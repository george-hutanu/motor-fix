import { nextTile, stateOf, TILES, type TileRow } from './tiles';

const at = (iso: string) => new Date(iso);
const t0 = at('2026-10-17T10:00:00Z');
const t1 = at('2026-10-17T10:00:30Z');
const t2 = at('2026-10-17T10:01:00Z');

// Fixture limits: not the build team's defaults.
const latency = { amber_ms: 500, red_ms: 2000 };
const email = { amber_ms: 500, amber_share: 0.1, red_ms: 2000, red_share: 0.5 };
const queue = {
  amber_age_s: 300,
  amber_share: 0.1,
  red_age_s: 900,
  red_share: 0.5,
};
const backup = { amber_h: 26, red_h: 50 };

const row = (over: Partial<TileRow> = {}): TileRow => ({
  checkedAt: t0,
  detail: { latency_ms: 80 },
  key: 'api',
  pendingSince: null,
  pendingState: null,
  since: at('2026-10-17T09:00:00Z'),
  state: 'green',
  ...over,
});

// @traces 294-FR-006
// @traces 294-FR-012
describe('the state of one check', () => {
  it.each([
    [82, 'green'],
    [499, 'green'],
    [500, 'amber'],
    [1999, 'amber'],
    [2000, 'red'],
    [9000, 'red'],
  ] as const)('is %s ms → %s, a limit counting as reached', (ms, state) => {
    expect(stateOf({ latency_ms: ms }, latency)).toBe(state);
  });

  it('is red when the check failed, whatever the limits', () => {
    expect(stateOf(null, latency)).toBe('red');
  });

  it('lets any one figure decide: a fast provider with many failed sends is red', () => {
    expect(stateOf({ failed_share: 0.5, latency_ms: 10 }, email)).toBe('red');
    expect(stateOf({ failed_share: 0.1, latency_ms: 10 }, email)).toBe('amber');
    expect(stateOf({ failed_share: 0, latency_ms: 2000 }, email)).toBe('red');
    expect(stateOf({ failed_share: 0.09, latency_ms: 499 }, email)).toBe(
      'green',
    );
  });

  it('judges the waiting-job age and the share of the notifications', () => {
    expect(stateOf({ failed_share: 0, oldest_waiting_s: 0 }, queue)).toBe(
      'green',
    );
    expect(stateOf({ failed_share: 0, oldest_waiting_s: 300 }, queue)).toBe(
      'amber',
    );
    expect(stateOf({ failed_share: 0.2, oldest_waiting_s: 900 }, queue)).toBe(
      'red',
    );
  });

  it('judges the hours since the last backup', () => {
    expect(stateOf({ backup_age_h: 3 }, backup)).toBe('green');
    expect(stateOf({ backup_age_h: 26 }, backup)).toBe('amber');
    expect(stateOf({ backup_age_h: 50 }, backup)).toBe('red');
  });

  it('lists the six tiles in a fixed order', () => {
    expect(TILES).toEqual([
      'api',
      'search',
      'maps',
      'email',
      'notifications',
      'backup',
    ]);
  });
});

// @traces 294-FR-007
// @traces 294-FR-008
// @traces 294-FR-009
// @traces 294-FR-012
describe('the stored state of a tile', () => {
  it('is created by the first check, with since at that check and an event', () => {
    expect(
      nextTile(
        'search',
        null,
        { detail: { latency_ms: 90 }, state: 'amber' },
        t0,
      ),
    ).toEqual({
      changed: true,
      row: {
        checkedAt: t0,
        detail: { latency_ms: 90 },
        key: 'search',
        pendingSince: null,
        pendingState: null,
        since: t0,
        state: 'amber',
      },
    });
  });

  it('keeps its state on a matching check but records the check and its figures', () => {
    const before = row();
    expect(
      nextTile(
        'api',
        before,
        { detail: { latency_ms: 95 }, state: 'green' },
        t1,
      ),
    ).toEqual({
      changed: false,
      row: { ...before, checkedAt: t1, detail: { latency_ms: 95 } },
    });
  });

  it('does not change on one differing check: it is held as pending', () => {
    const before = row();
    const { changed, row: after } = nextTile(
      'api',
      before,
      { detail: { latency_ms: 2500 }, state: 'red' },
      t1,
    );
    expect(changed).toBe(false);
    expect(after).toEqual({
      ...before,
      checkedAt: t1,
      detail: { latency_ms: 2500 },
      pendingSince: t1,
      pendingState: 'red',
    });
  });

  it('changes on the second agreeing check, since set to the first of the two', () => {
    const before = row({ pendingSince: t1, pendingState: 'red' });
    expect(
      nextTile(
        'api',
        before,
        { detail: { reason: 'timeout' }, state: 'red' },
        t2,
      ),
    ).toEqual({
      changed: true,
      row: {
        ...before,
        checkedAt: t2,
        detail: { reason: 'timeout' },
        pendingSince: null,
        pendingState: null,
        since: t1,
        state: 'red',
      },
    });
  });

  it('does not change on amber then red: the pending check moves to red', () => {
    const before = row({ pendingSince: t1, pendingState: 'amber' });
    const { changed, row: after } = nextTile(
      'api',
      before,
      { detail: { latency_ms: 2500 }, state: 'red' },
      t2,
    );
    expect(changed).toBe(false);
    expect(after.state).toBe('green');
    expect(after.pendingState).toBe('red');
    expect(after.pendingSince).toEqual(t2);
  });

  it('drops the pending check when the next one is back to the stored state', () => {
    const before = row({ pendingSince: t1, pendingState: 'red' });
    const { changed, row: after } = nextTile(
      'api',
      before,
      { detail: { latency_ms: 70 }, state: 'green' },
      t2,
    );
    expect(changed).toBe(false);
    expect(after).toEqual({
      ...before,
      checkedAt: t2,
      detail: { latency_ms: 70 },
      pendingSince: null,
      pendingState: null,
    });
  });

  it('raises no event over ten checks with one bad sample among them', () => {
    let current: TileRow = row();
    let events = 0;
    for (let n = 0; n < 10; n += 1) {
      const state = n === 4 ? 'red' : 'green';
      const next = nextTile(
        'api',
        current,
        { detail: {}, state },
        new Date(t0.getTime() + n * 30_000),
      );
      if (next.changed) events += 1;
      current = next.row;
    }
    expect(events).toBe(0);
    expect(current.state).toBe('green');
    expect(current.pendingState).toBeNull();
  });
});
