import { entryOf, KINDS, minuteOf, SOURCES } from './entry';

const at = new Date('2026-10-17T10:41:27.512Z');

// @traces 297-FR-002
describe('the kinds and sources an entry may name', () => {
  it('are the eight kinds and ten sources of the log', () => {
    expect(KINDS).toEqual([
      'status_changed',
      'check_failed',
      'job_failed',
      'service_error',
      'server_error',
      'backup_completed',
      'backup_failed',
      'deploy',
    ]);
    expect(SOURCES).toEqual([
      'api',
      'search',
      'maps',
      'email',
      'notifications',
      'backup',
      'worker',
      'webrtc',
      'identity',
      'storage',
    ]);
  });
});

// @traces 297-FR-003
describe('the minute an entry is grouped in', () => {
  it('is its time cut to the minute', () => {
    expect(minuteOf(at)).toEqual(new Date('2026-10-17T10:41:00.000Z'));
    expect(minuteOf(new Date('2026-10-17T10:41:59.999Z'))).toEqual(
      new Date('2026-10-17T10:41:00.000Z'),
    );
  });
});

// @traces 297-FR-006
describe('a tile change', () => {
  it('to amber names the figure and the limit it went over, as a warning', () => {
    expect(
      entryOf(
        'status_changed',
        'maps',
        { figure: 'latency_ms', latency_ms: 1900, limit: 1500, state: 'amber' },
        at,
      ),
    ).toEqual({
      fingerprint: 'amber',
      message: 'Maps: response time went above 1.5 s.',
      severity: 'warning',
    });
  });

  it.each([
    ['failed_share', 0.12, 'email', 'E-mail: failed sends went above 12 %.'],
    [
      'oldest_waiting_s',
      300,
      'notifications',
      'Notifications: oldest waiting job went above 5 min.',
    ],
    ['backup_age_h', 26, 'backup', 'Backup: backup age went above 26 h.'],
    ['latency_ms', 800, 'api', 'API: response time went above 800 ms.'],
  ] as const)(
    'formats a %s limit in its unit',
    (figure, limit, tile, message) => {
      expect(
        entryOf('status_changed', tile, { figure, limit, state: 'red' }, at)
          ?.message,
      ).toBe(message);
    },
  );

  it('to red after a failed check names the reason', () => {
    expect(
      entryOf(
        'status_changed',
        'search',
        { reason: 'http_503', state: 'red' },
        at,
      ),
    ).toEqual({
      fingerprint: 'red',
      message: 'Search: turned red (http_503).',
      severity: 'warning',
    });
  });

  it('back to green is information', () => {
    expect(
      entryOf('status_changed', 'api', { latency_ms: 80, state: 'green' }, at),
    ).toEqual({
      fingerprint: 'green',
      message: 'API: back to normal.',
      severity: 'info',
    });
  });

  it('a failed check is a warning grouped by its reason', () => {
    expect(entryOf('check_failed', 'email', { reason: 'timeout' }, at)).toEqual(
      {
        fingerprint: 'timeout',
        message: 'E-mail: check failed (timeout).',
        severity: 'warning',
      },
    );
  });
});

// @traces 297-FR-007
describe('a job that failed for good', () => {
  it('is an error grouped by queue, job and error code', () => {
    expect(
      entryOf(
        'job_failed',
        'worker',
        {
          attempts: 3,
          error_code: 'BrevoError',
          job: 'deliver',
          queue: 'notifications',
        },
        at,
      ),
    ).toEqual({
      fingerprint: 'notifications:deliver:BrevoError',
      message:
        'Job deliver on notifications failed for good after 3 attempts (BrevoError).',
      severity: 'error',
    });
  });
});

// @traces 297-FR-008
describe('an outside service error', () => {
  it('names the provider and its status', () => {
    expect(
      entryOf('service_error', 'email', { provider: 'brevo', status: 503 }, at),
    ).toEqual({
      fingerprint: 'brevo:503',
      message: 'Brevo answered 503.',
      severity: 'error',
    });
  });

  it('or the reason it could not answer', () => {
    expect(
      entryOf(
        'service_error',
        'maps',
        { provider: 'geoapify', reason: 'timeout' },
        at,
      ),
    ).toEqual({
      fingerprint: 'geoapify:timeout',
      message: 'Geoapify answered timeout.',
      severity: 'error',
    });
  });
});

// @traces 297-FR-009
describe('an unexpected server error', () => {
  it('is grouped by method and route template', () => {
    expect(
      entryOf(
        'server_error',
        'api',
        { method: 'GET', route: '/api/v1/garages/:slug' },
        at,
      ),
    ).toEqual({
      fingerprint: 'GET /api/v1/garages/:slug',
      message: 'Unexpected error on GET /api/v1/garages/:slug.',
      severity: 'error',
    });
  });

  it('with no route matched is grouped as unknown', () => {
    expect(
      entryOf('server_error', 'api', { method: 'POST', route: 'unknown' }, at)
        ?.fingerprint,
    ).toBe('unknown');
  });
});

// @traces 297-FR-010
describe('the backups', () => {
  it('a completed backup is information grouped by its time', () => {
    expect(
      entryOf(
        'backup_completed',
        'backup',
        { backup_at: '2026-10-17T00:02:11.000Z' },
        at,
      ),
    ).toEqual({
      fingerprint: '2026-10-17T00:02:11.000Z',
      message: 'Backup completed at 2026-10-17T00:02:11.000Z.',
      severity: 'info',
    });
  });

  it('a missing backup is an error grouped by the day', () => {
    expect(
      entryOf(
        'backup_failed',
        'backup',
        { last_backup_at: '2026-10-15T00:02:11.000Z', reason: 'too_old' },
        at,
      ),
    ).toEqual({
      fingerprint: '2026-10-17',
      message: 'No backup since 2026-10-15T00:02:11.000Z.',
      severity: 'error',
    });
  });
});

// @traces 297-FR-011
describe('a deploy', () => {
  it('is information grouped by its version', () => {
    expect(entryOf('deploy', 'worker', { version: 'a1b2c3d' }, at)).toEqual({
      fingerprint: 'a1b2c3d',
      message: 'Deployed a1b2c3d.',
      severity: 'info',
    });
  });
});
