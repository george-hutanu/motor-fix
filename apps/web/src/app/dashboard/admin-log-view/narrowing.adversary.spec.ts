import {
  dayLimits,
  filterOf,
  filtersSet,
  type LogFilter,
  paramsOf,
  passes,
  queryOf,
  rangeFault,
} from './narrowing';

const NOW = new Date('2026-10-17T12:00:00.000Z');

const base: LogFilter = {
  from: '2026-10-11',
  q: '',
  severity: null,
  source: null,
  to: '2026-10-17',
  type: null,
};

// @traces 299-FR-009 299-FR-011
describe('the address under hostile values', () => {
  it.each([
    ['a day that does not exist', '2026-02-30'],
    ['a time on the day', '2026-10-11T00:00:00Z'],
    ['a trailing space', '2026-10-11 '],
    ['a number', 20261011],
    ['an empty string', ''],
    ['null', null],
    ['an object', { a: 1 }],
    ['full-width digits', '２０２６-１０-１１'],
  ])('drops %s as the start and keeps the default range', (_, from) => {
    expect(filterOf({ from }, NOW).filter).toMatchObject({
      from: '2026-10-11',
      to: '2026-10-17',
    });
  });

  it.each([
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'BACKUP',
    ' backup',
    'backup ',
  ])('drops "%s" as the type', (kind) => {
    expect(filterOf({ kind }, NOW).filter.type).toBeNull();
  });

  it.each(['__proto__', 'constructor', 'Error', 'ERROR', 'critical'])(
    'drops "%s" as the severity',
    (severity) => {
      expect(filterOf({ severity }, NOW).filter.severity).toBeNull();
    },
  );

  it('asks for the address to be rewritten when it holds an unknown value', () => {
    expect(filterOf({ kind: 'nope' }, NOW).rewrite).toBe(true);
  });

  it('keeps a well-formed split surrogate out of the search when it cuts at 100', () => {
    const q = `a${'😀'.repeat(60)}`;
    const { filter } = filterOf({ q }, NOW);

    expect(filter.q.isWellFormed()).toBe(true);
    expect(() => encodeURIComponent(filter.q)).not.toThrow();
  });

  it('cuts a search of 150 characters to exactly 100', () => {
    expect(filterOf({ q: 'a'.repeat(150) }, NOW).filter.q).toHaveLength(100);
  });

  it('keeps a search of exactly 2 characters and drops one of 1', () => {
    expect(filterOf({ q: 'ab' }, NOW).filter.q).toBe('ab');
    expect(filterOf({ q: 'a' }, NOW).filter.q).toBe('');
  });

  it('drops a search of two spaces and a letter that trims to one character', () => {
    expect(filterOf({ q: '  a ' }, NOW).filter.q).toBe('');
  });

  it.each([
    ['a list', ['ab', 'cd']],
    ['a number', 42],
    ['an object', { a: 'ab' }],
  ])('reads %s as the search without throwing', (_, q) => {
    expect(() => filterOf({ q }, NOW)).not.toThrow();
  });

  it('does not ask for a rewrite of a clean address a second time', () => {
    const first = filterOf(
      { from: '2026-01-01', kind: 'nope', q: ' a ', to: '2030-01-01' },
      NOW,
    );
    const second = filterOf(
      Object.fromEntries(
        Object.entries(paramsOf(first.filter, NOW)).filter(
          ([, value]) => value !== null,
        ),
      ),
      NOW,
    );

    expect(second.rewrite).toBe(false);
    expect(second.filter).toEqual(first.filter);
  });

  it('clamps a start before the retention to the oldest day kept and the end past today to today', () => {
    const { min, max } = dayLimits(NOW);

    expect(
      filterOf({ from: '2020-01-01', to: '2099-01-01' }, NOW).filter,
    ).toMatchObject({ from: min, to: max });
  });

  it('keeps a start exactly on the oldest day kept and one day older is moved', () => {
    const { min } = dayLimits(NOW);

    expect(filterOf({ from: min, to: '2026-10-17' }, NOW).rewrite).toBe(false);
    expect(
      filterOf({ from: '2026-07-18', to: '2026-10-17' }, NOW).filter.from,
    ).toBe(min);
  });

  it('defaults the start to six days before the end for an end alone', () => {
    expect(filterOf({ to: '2026-10-05' }, NOW).filter).toMatchObject({
      from: '2026-09-29',
      to: '2026-10-05',
    });
  });

  it('never leaves the end before the start', () => {
    const { filter } = filterOf({ from: '2026-10-15', to: '2026-10-01' }, NOW);

    expect(filter.to >= filter.from).toBe(true);
  });
});

// @traces 299-FR-010
describe('the API query at the changes of the clock', () => {
  it('starts the day of the change to summer time at 22:00 UTC the evening before', () => {
    const query = queryOf({ ...base, from: '2026-03-29', to: '2026-03-29' });

    expect(query.from).toBe('2026-03-28T22:00:00.000Z');
    expect(query.to).toBe('2026-03-29T21:00:00.000Z');
  });

  it('ends the day of the change to winter time at 22:00 UTC', () => {
    const query = queryOf({ ...base, from: '2026-10-25', to: '2026-10-25' });

    expect(query.from).toBe('2026-10-24T21:00:00.000Z');
    expect(query.to).toBe('2026-10-25T22:00:00.000Z');
  });

  it('crosses a month and a leap day when it adds the day to the end', () => {
    expect(queryOf({ ...base, from: '2028-02-28', to: '2028-02-29' }).to).toBe(
      '2028-02-29T22:00:00.000Z',
    );
    expect(queryOf({ ...base, from: '2026-12-31', to: '2026-12-31' }).to).toBe(
      '2026-12-31T22:00:00.000Z',
    );
  });

  it('sends no empty search, no cursor and no empty filters', () => {
    const query = queryOf(base, '');

    expect(Object.keys(query).sort()).toEqual(['from', 'limit', 'to']);
  });

  it('sends the kinds of a type as a copy that later edits cannot change', () => {
    const query = queryOf({ ...base, type: 'backup' });
    query.kind?.push('deploy');

    expect(queryOf({ ...base, type: 'backup' }).kind).toEqual([
      'backup_completed',
      'backup_failed',
    ]);
  });
});

// @traces 299-FR-010
describe('the range check at its edges', () => {
  it('accepts today alone and the oldest day alone', () => {
    const { min, max } = dayLimits(NOW);

    expect(rangeFault({ from: max, to: max }, NOW)).toBeUndefined();
    expect(rangeFault({ from: min, to: min }, NOW)).toBeUndefined();
  });

  it('names the start when it is the day after today', () => {
    expect(
      rangeFault({ from: '2026-10-18', to: '2026-10-18' }, NOW),
    ).toMatchObject({ field: 'from' });
  });

  it('names the end when it is the day before the start', () => {
    expect(
      rangeFault({ from: '2026-10-12', to: '2026-10-11' }, NOW),
    ).toMatchObject({ field: 'to' });
  });

  it('names the start when it is the day before the oldest day', () => {
    expect(
      rangeFault({ from: '2026-07-18', to: '2026-10-17' }, NOW),
    ).toMatchObject({ field: 'from' });
  });

  it.each(['', '2026-02-30', 'tomorrow'])(
    'names the end when it is "%s"',
    (to) => {
      expect(rangeFault({ from: '2026-10-11', to }, NOW)).toMatchObject({
        field: 'to',
      });
    },
  );
});

// @traces 299-FR-014
describe('which new entries count under hostile events', () => {
  const event = {
    entryKind: 'deploy',
    severity: 'info',
    source: 'api',
  } as const;

  it('does not count an unknown kind against a type', () => {
    expect(
      passes(
        { ...base, type: 'backup' },
        { ...event, entryKind: 'toString' as never },
      ),
    ).toBe(false);
  });

  it('counts every event when no filter is set', () => {
    expect(passes(base, event)).toBe(true);
  });

  it('counts the filters set once each, however the range looks', () => {
    expect(
      filtersSet(
        { ...base, q: 'abc', severity: 'error', source: 'api', type: 'jobs' },
        NOW,
      ),
    ).toBe(3);
  });
});
