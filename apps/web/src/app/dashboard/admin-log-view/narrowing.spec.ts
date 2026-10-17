import {
  dayLimits,
  filterOf,
  filtersSet,
  includesToday,
  LOG_TYPES,
  type LogFilter,
  paramsOf,
  passes,
  queryOf,
  rangeFault,
} from './narrowing';

const NOW = new Date('2026-10-17T12:00:00.000Z');
// Before midnight in UTC, already the next day in Bucharest.
const LATE = new Date('2026-10-17T22:30:00.000Z');

const base: LogFilter = {
  from: '2026-10-11',
  q: '',
  severity: null,
  source: null,
  to: '2026-10-17',
  type: null,
};

// @traces 299-FR-007 299-FR-009
describe('the default range', () => {
  it('is today and the six days before in Bucharest', () => {
    expect(filterOf({}, NOW)).toEqual({ filter: base, rewrite: false });
  });

  it('follows the day in Bucharest, not in UTC', () => {
    expect(filterOf({}, LATE).filter).toMatchObject({
      from: '2026-10-12',
      to: '2026-10-18',
    });
  });

  it('is not written to the address', () => {
    expect(paramsOf(base, NOW)).toEqual({
      from: null,
      kind: null,
      q: null,
      severity: null,
      source: null,
      to: null,
    });
  });
});

// @traces 299-FR-007 299-FR-010
describe('the API query', () => {
  it('sends the start of the from day and the start of the day after the to day, fifty a page', () => {
    expect(queryOf(base)).toEqual({
      from: '2026-10-10T21:00:00.000Z',
      limit: 50,
      to: '2026-10-17T21:00:00.000Z',
    });
  });

  it('keeps the Bucharest midnight across the change to winter time', () => {
    expect(
      queryOf({ ...base, from: '2026-10-24', to: '2026-10-26' }),
    ).toMatchObject({
      from: '2026-10-23T21:00:00.000Z',
      to: '2026-10-26T22:00:00.000Z',
    });
  });

  it('carries the cursor, the kinds of the type, the severity, the source and the search', () => {
    expect(
      queryOf(
        {
          ...base,
          q: 'brevo',
          severity: 'error',
          source: 'backup',
          type: 'backup',
        },
        'abc',
      ),
    ).toEqual({
      cursor: 'abc',
      from: '2026-10-10T21:00:00.000Z',
      kind: ['backup_completed', 'backup_failed'],
      limit: 50,
      q: 'brevo',
      severity: ['error'],
      source: ['backup'],
      to: '2026-10-17T21:00:00.000Z',
    });
  });
});

// @traces 299-FR-008
describe('the types', () => {
  it('group the kinds as an admin names them', () => {
    expect(LOG_TYPES).toEqual({
      backup: ['backup_completed', 'backup_failed'],
      checks: ['check_failed'],
      deploy: ['deploy'],
      jobs: ['job_failed'],
      servers: ['server_error'],
      services: ['service_error'],
      status: ['status_changed'],
    });
  });
});

// @traces 299-FR-009
describe('the address', () => {
  const full: LogFilter = {
    from: '2026-10-01',
    q: 'brevo',
    severity: 'error',
    source: 'email',
    to: '2026-10-03',
    type: 'services',
  };

  it('round-trips every filter', () => {
    const params = paramsOf(full, NOW);

    expect(params).toEqual({
      from: '2026-10-01',
      kind: 'services',
      q: 'brevo',
      severity: 'error',
      source: 'email',
      to: '2026-10-03',
    });
    expect(filterOf(params, NOW)).toEqual({ filter: full, rewrite: false });
  });

  it('drops unknown values and keeps the rest', () => {
    expect(
      filterOf(
        {
          kind: 'backups',
          q: 'brevo',
          severity: 'fatal',
          source: 'email',
          zone: 'x',
        },
        NOW,
      ),
    ).toEqual({
      filter: { ...base, q: 'brevo', source: 'email' },
      rewrite: true,
    });
  });

  it.each([
    ['not a day', { from: 'yesterday' }],
    ['a day that does not exist', { from: '2026-02-30' }],
  ])('drops a from that is %s', (_, params) => {
    expect(filterOf(params, NOW)).toEqual({ filter: base, rewrite: true });
  });

  it('defaults the end to today when only the start is given, and writes both', () => {
    const { filter, rewrite } = filterOf({ from: '2026-10-01' }, NOW);

    expect(filter).toMatchObject({ from: '2026-10-01', to: '2026-10-17' });
    expect(rewrite).toBe(true);
    expect(paramsOf(filter, NOW)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-17',
    });
  });

  it('defaults the start to six days before the end when only the end is given, and writes both', () => {
    const { filter, rewrite } = filterOf({ to: '2026-10-03' }, NOW);

    expect(filter).toMatchObject({ from: '2026-09-27', to: '2026-10-03' });
    expect(rewrite).toBe(true);
    expect(paramsOf(filter, NOW)).toMatchObject({
      from: '2026-09-27',
      to: '2026-10-03',
    });
  });

  it('writes a range that differs from the default by its end only', () => {
    expect(paramsOf({ ...base, to: '2026-10-16' }, NOW)).toMatchObject({
      from: '2026-10-11',
      to: '2026-10-16',
    });
  });

  it('keeps the start inside the ninety days kept and the end no later than today', () => {
    expect(filterOf({ from: '2026-01-01', to: '2026-12-31' }, NOW)).toEqual({
      filter: { ...base, from: '2026-07-19', to: '2026-10-17' },
      rewrite: true,
    });
  });

  it('drops an end before the start', () => {
    expect(filterOf({ from: '2026-10-05', to: '2026-10-01' }, NOW)).toEqual({
      filter: { ...base, from: '2026-10-05', to: '2026-10-17' },
      rewrite: true,
    });
  });

  it('trims the search, cuts it at 100 and drops one under 2 characters', () => {
    expect(filterOf({ q: '  brevo ' }, NOW).filter.q).toBe('brevo');
    expect(filterOf({ q: 'a'.repeat(120) }, NOW).filter.q).toBe(
      'a'.repeat(100),
    );
    expect(filterOf({ q: ' a ' }, NOW)).toEqual({
      filter: base,
      rewrite: true,
    });
  });

  it('reads the first of repeated values', () => {
    expect(filterOf({ severity: ['error', 'info'] }, NOW).filter.severity).toBe(
      'error',
    );
  });
});

// @traces 299-FR-010
describe('the date limits', () => {
  it('run from ninety days ago to today', () => {
    expect(dayLimits(NOW)).toEqual({ max: '2026-10-17', min: '2026-07-19' });
  });

  it('accept the widest range', () => {
    expect(
      rangeFault({ from: '2026-07-19', to: '2026-10-17' }, NOW),
    ).toBeUndefined();
  });

  it.each([
    [
      'a start after today',
      { from: '2026-10-18', to: '2026-10-18' },
      'from',
      'future',
    ],
    [
      'an end after today',
      { from: '2026-10-11', to: '2026-10-18' },
      'to',
      'future',
    ],
    [
      'a start older than ninety days',
      { from: '2026-07-18', to: '2026-10-17' },
      'from',
      'tooOld',
    ],
    [
      'an end before the start',
      { from: '2026-10-11', to: '2026-10-10' },
      'to',
      'beforeFrom',
    ],
    ['an empty start', { from: '', to: '2026-10-17' }, 'from', 'missing'],
    ['an empty end', { from: '2026-10-11', to: '' }, 'to', 'missing'],
  ])('name the input at fault for %s', (_, range, field, reason) => {
    expect(rangeFault(range, NOW)).toEqual({
      field,
      key: `admin.log.view.dates.${reason}`,
    });
  });
});

// @traces 299-FR-008
describe('the count of filters set', () => {
  it('is nothing on the default view', () => {
    expect(filtersSet(base, NOW)).toBe(0);
  });

  it('counts the type, the severity, the source and a range other than the default, not the search', () => {
    expect(
      filtersSet(
        {
          ...base,
          from: '2026-10-01',
          q: 'brevo',
          severity: 'error',
          source: 'email',
          type: 'backup',
        },
        NOW,
      ),
    ).toBe(4);
  });
});

// @traces 299-FR-014
describe('which new entries count', () => {
  const event = {
    entryKind: 'backup_failed',
    severity: 'error',
    source: 'backup',
  } as const;

  it('counts only while the range ends today', () => {
    expect(includesToday(base, NOW)).toBe(true);
    expect(includesToday({ ...base, to: '2026-10-16' }, NOW)).toBe(false);
  });

  it('passes an event that every filter allows', () => {
    expect(passes(base, event)).toBe(true);
    expect(
      passes(
        { ...base, severity: 'error', source: 'backup', type: 'backup' },
        event,
      ),
    ).toBe(true);
  });

  it.each([
    ['type', { type: 'jobs' }],
    ['severity', { severity: 'warning' }],
    ['source', { source: 'email' }],
  ] as const)('drops an event its %s does not allow', (_, narrowing) => {
    expect(passes({ ...base, ...narrowing }, event)).toBe(false);
  });
});
