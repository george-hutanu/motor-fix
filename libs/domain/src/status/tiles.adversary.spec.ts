import { type Check, nextTile, stateOf, TILES, type TileRow } from './tiles';

const at = (seconds: number) =>
  new Date(Date.parse('2026-10-17T10:00:00Z') + seconds * 1000);

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

const check = (state: Check['state'], ms = 1): Check => ({
  detail: { latency_ms: ms },
  state,
});

const base = (over: Partial<TileRow> = {}): TileRow => ({
  checkedAt: at(0),
  detail: { latency_ms: 80 },
  key: 'api',
  pendingSince: null,
  pendingState: null,
  since: at(-3600),
  state: 'green',
  ...over,
});

// @traces 294-FR-006
describe('the boundary of every limit', () => {
  it.each([
    [499.999, 'green'],
    [500, 'amber'],
    [500.001, 'amber'],
    [1999.999, 'amber'],
    [2000, 'red'],
    [2000.001, 'red'],
    [0, 'green'],
  ])('puts a latency of %s ms at %s', (ms, state) => {
    expect(stateOf({ latency_ms: ms }, latency)).toBe(state);
  });

  it.each([
    [0.0999, 'green'],
    [0.1, 'amber'],
    [0.4999, 'amber'],
    [0.5, 'red'],
    [1, 'red'],
    [0, 'green'],
  ])('puts a failed share of %s at %s', (share, state) => {
    expect(stateOf({ failed_share: share }, email)).toBe(state);
  });

  it.each([
    [299, 'green'],
    [300, 'amber'],
    [899, 'amber'],
    [900, 'red'],
  ])('puts a waiting age of %s s at %s', (age, state) => {
    expect(stateOf({ oldest_waiting_s: age }, queue)).toBe(state);
  });

  it.each([
    [25.99, 'green'],
    [26, 'amber'],
    [49.99, 'amber'],
    [50, 'red'],
    [-3, 'green'],
  ])('puts a backup %s hours old at %s', (hours, state) => {
    expect(stateOf({ backup_age_h: hours }, backup)).toBe(state);
  });

  it('is green with no figure at all', () => {
    expect(stateOf({}, email)).toBe('green');
  });

  it('is red for a failed check even with an empty limits object', () => {
    expect(stateOf(null, {})).toBe('red');
  });

  it('is red when the share is red although the latency is green', () => {
    expect(stateOf({ failed_share: 0.5, latency_ms: 1 }, email)).toBe('red');
  });

  it('is red when the latency is red although the share is amber', () => {
    expect(stateOf({ failed_share: 0.1, latency_ms: 2000 }, email)).toBe('red');
  });

  it('is amber when one figure is amber and the other green', () => {
    expect(stateOf({ failed_share: 0, latency_ms: 500 }, email)).toBe('amber');
  });

  it('does not change the figures or limits it was given', () => {
    const figures = { failed_share: 0.2, latency_ms: 600 };
    const limits = { ...email };
    stateOf(figures, limits);
    expect(figures).toEqual({ failed_share: 0.2, latency_ms: 600 });
    expect(limits).toEqual(email);
  });

  it('is the same on a second call with the same input', () => {
    const figures = { latency_ms: 700 };
    expect(stateOf(figures, latency)).toBe(stateOf(figures, latency));
  });

  it('lists the six tiles once each', () => {
    expect([...TILES].sort()).toEqual([
      'api',
      'backup',
      'email',
      'maps',
      'notifications',
      'search',
    ]);
  });
});

// @traces 294-FR-007
// @traces 294-FR-009
describe('flapping sequences', () => {
  const run = (states: Check['state'][], start: TileRow | null = null) => {
    let row = start;
    const changes: number[] = [];
    states.forEach((state, index) => {
      const result = nextTile('api', row, check(state), at(index * 30));
      if (result.changed) changes.push(index);
      row = result.row;
    });
    return { changes, row: row as TileRow };
  };

  it('raises no event over ten checks with one bad sample in any position', () => {
    for (let bad = 0; bad < 10; bad++) {
      const states = Array.from({ length: 10 }, (_, i) =>
        i === bad ? ('red' as const) : ('green' as const),
      );
      const { changes, row } = run(states, base({ checkedAt: at(-30) }));
      expect(changes).toEqual([]);
      expect(row.state).toBe('green');
      expect(row.since).toEqual(at(-3600));
    }
  });

  it('raises no event when good and bad alternate for twenty checks', () => {
    const states = Array.from({ length: 20 }, (_, i) =>
      i % 2 ? ('green' as const) : ('red' as const),
    );
    const { changes, row } = run(states, base({ checkedAt: at(-30) }));
    expect(changes).toEqual([]);
    expect(row.state).toBe('green');
  });

  it('raises no event when red and amber alternate against a green tile', () => {
    const states = Array.from({ length: 12 }, (_, i) =>
      i % 2 ? ('amber' as const) : ('red' as const),
    );
    const { changes } = run(states, base({ checkedAt: at(-30) }));
    expect(changes).toEqual([]);
  });

  it('changes exactly once on a steady outage and sets since to the first bad check', () => {
    const states = ['green', 'red', 'red', 'red', 'red'] as Check['state'][];
    const { changes, row } = run(states, base({ checkedAt: at(-30) }));
    expect(changes).toEqual([2]);
    expect(row.state).toBe('red');
    expect(row.since).toEqual(at(30));
    expect(row.pendingState).toBeNull();
    expect(row.pendingSince).toBeNull();
  });

  it('changes back to green with since at the first good check', () => {
    const { changes, row } = run(
      ['red', 'red', 'green', 'green', 'green'],
      base({ checkedAt: at(-30), since: at(-600), state: 'red' }),
    );
    expect(changes).toEqual([3]);
    expect(row.state).toBe('green');
    expect(row.since).toEqual(at(60));
  });

  it('walks green to amber to red when each state holds for two checks', () => {
    const { changes, row } = run(
      ['amber', 'amber', 'red', 'red'],
      base({ checkedAt: at(-30) }),
    );
    expect(changes).toEqual([1, 3]);
    expect(row.state).toBe('red');
    expect(row.since).toEqual(at(60));
  });

  it('a bad check restarts the count: bad, good, bad, bad changes at the fourth with since at the third', () => {
    const { changes, row } = run(
      ['red', 'green', 'red', 'red'],
      base({ checkedAt: at(-30) }),
    );
    expect(changes).toEqual([3]);
    expect(row.since).toEqual(at(60));
  });

  it('never reports a change for the check that only confirms nothing', () => {
    const result = nextTile('api', base(), check('green'), at(30));
    expect(result.changed).toBe(false);
    expect(result.row.pendingState).toBeNull();
    expect(result.row.pendingSince).toBeNull();
  });

  it('holds a differing check as pending with its own time and leaves since alone', () => {
    const result = nextTile('api', base(), check('amber'), at(30));
    expect(result).toMatchObject({
      changed: false,
      row: {
        pendingSince: at(30),
        pendingState: 'amber',
        since: at(-3600),
        state: 'green',
      },
    });
  });

  it('keeps the first pending time when a second pending check of the same state arrives after a change of pending state', () => {
    const first = nextTile('api', base(), check('amber'), at(30));
    const second = nextTile('api', first.row, check('red'), at(60));
    expect(second.changed).toBe(false);
    expect(second.row.pendingState).toBe('red');
    expect(second.row.pendingSince).toEqual(at(60));
  });

  it('records the latest check detail on the changing check, not the first', () => {
    const first = nextTile('api', base(), check('red', 111), at(30));
    const second = nextTile('api', first.row, check('red', 222), at(60));
    expect(second.row.detail).toEqual({ latency_ms: 222 });
    expect(second.row.checkedAt).toEqual(at(60));
  });

  it('records the detail of a pending check on the row', () => {
    const result = nextTile('api', base(), check('red', 999), at(30));
    expect(result.row.detail).toEqual({ latency_ms: 999 });
    expect(result.row.checkedAt).toEqual(at(30));
  });

  it('does not change the row it was given', () => {
    const before = base();
    const copy = structuredClone(before);
    nextTile('api', before, check('red'), at(30));
    nextTile('api', before, check('green'), at(30));
    expect(before).toEqual(copy);
  });

  it('writes the key it was asked about on the new row', () => {
    expect(nextTile('backup', null, check('green'), at(0)).row.key).toBe(
      'backup',
    );
  });

  it('gives a second event on the first run only once: the same first check applied again changes nothing', () => {
    const first = nextTile('api', null, check('amber'), at(0));
    const again = nextTile('api', first.row, check('amber'), at(0));
    expect(first.changed).toBe(true);
    expect(again.changed).toBe(false);
    expect(again.row.since).toEqual(at(0));
  });

  it('applying a confirmed change a third time changes nothing', () => {
    const one = nextTile('api', base(), check('red'), at(30));
    const two = nextTile('api', one.row, check('red'), at(60));
    const three = nextTile('api', two.row, check('red'), at(90));
    expect(two.changed).toBe(true);
    expect(three.changed).toBe(false);
    expect(three.row.since).toEqual(at(30));
  });

  it('never leaves a changed state with a null since when the stored pending time is missing', () => {
    const corrupt = base({ pendingSince: null, pendingState: 'red' });
    const result = nextTile('api', corrupt, check('red'), at(30));
    expect(result.row.since).toBeInstanceOf(Date);
    expect(Number.isNaN(result.row.since.getTime())).toBe(false);
  });

  it('treats a stored pending equal to the stored state as no pending check', () => {
    const odd = base({
      pendingSince: at(-30),
      pendingState: 'green',
      state: 'green',
    });
    const result = nextTile('api', odd, check('green'), at(30));
    expect(result.changed).toBe(false);
    expect(result.row.state).toBe('green');
  });

  it('survives ten thousand checks with a bad one every hundred and raises no event', () => {
    let row: TileRow | null = base({ checkedAt: at(-30) });
    let events = 0;
    for (let i = 0; i < 10_000; i++) {
      const result = nextTile(
        'api',
        row,
        check(i % 100 === 50 ? 'red' : 'green'),
        at(i * 30),
      );
      if (result.changed) events++;
      row = result.row;
    }
    expect(events).toBe(0);
  });
});
