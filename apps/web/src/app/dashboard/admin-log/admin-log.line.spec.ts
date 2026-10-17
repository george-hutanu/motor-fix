import { TestBed } from '@angular/core/testing';
import type { SystemLogEntryDto } from '@motor-fix/data-access';
import { formatClock, formatDay, I18n } from '@motor-fix/i18n';

import { lineOf } from './admin-log.line';

const entry = (
  kind: string,
  source: string,
  context: Record<string, unknown>,
  message = 'Stored English message.',
): SystemLogEntryDto =>
  ({
    at: '2026-10-17T07:40:00.000Z',
    context,
    count: 1,
    id: 'entry-1',
    kind,
    message,
    severity: 'info',
    source,
  }) as SystemLogEntryDto;

async function i18nIn(language: 'ro' | 'en') {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  return i18n;
}

afterEach(() => TestBed.resetTestingModule());

const BACKUP_AT = '2026-10-17T00:30:00.000Z';
const LAST_BACKUP = '2026-10-15T00:30:00.000Z';

// Each case: the entry, its Romanian line, its English line.
const CASES: [string, SystemLogEntryDto, string, string][] = [
  [
    'a tile back to normal',
    entry('status_changed', 'maps', { state: 'green' }),
    'Hărți: a revenit la normal.',
    'Maps: back to normal.',
  ],
  [
    'a response time above its limit, in seconds',
    entry('status_changed', 'maps', {
      figure: 'latency_ms',
      limit: 1500,
      state: 'amber',
    }),
    'Hărți: timpul de răspuns a trecut de 1,5 s.',
    'Maps: response time went above 1.5 s.',
  ],
  [
    'a response time above its limit, in milliseconds',
    entry('status_changed', 'api', {
      figure: 'latency_ms',
      limit: 800,
      state: 'amber',
    }),
    'API: timpul de răspuns a trecut de 800 ms.',
    'API: response time went above 800 ms.',
  ],
  [
    'a failed-send share above its limit, as a percent',
    entry('status_changed', 'notifications', {
      figure: 'failed_share',
      limit: 0.05,
      state: 'red',
    }),
    'Notificări: rata trimiterilor eșuate a trecut de 5 %.',
    'Notifications: failed sends went above 5 %.',
  ],
  [
    'an oldest waiting job above its limit, in minutes',
    entry('status_changed', 'email', {
      figure: 'oldest_waiting_s',
      limit: 120,
      state: 'amber',
    }),
    'E‑mail: cel mai vechi job în așteptare a trecut de 2 min.',
    'E-mail: oldest waiting job went above 2 min.',
  ],
  [
    'an oldest waiting job above its limit, in seconds',
    entry('status_changed', 'email', {
      figure: 'oldest_waiting_s',
      limit: 45,
      state: 'amber',
    }),
    'E‑mail: cel mai vechi job în așteptare a trecut de 45 s.',
    'E-mail: oldest waiting job went above 45 s.',
  ],
  [
    'a backup age above its limit, in hours',
    entry('status_changed', 'backup', {
      figure: 'backup_age_h',
      limit: 26,
      state: 'red',
    }),
    'Backup: vechimea backupului a trecut de 26 h.',
    'Backup: backup age went above 26 h.',
  ],
  [
    'a tile turning a state with no figure',
    entry('status_changed', 'search', { state: 'red' }),
    'Căutare: a trecut pe roșu.',
    'Search: turned red.',
  ],
  [
    'a tile turning a state for a reason',
    entry('status_changed', 'search', { reason: 'timeout', state: 'amber' }),
    'Căutare: a trecut pe galben (timeout).',
    'Search: turned amber (timeout).',
  ],
  [
    'a failed check',
    entry('check_failed', 'backup', { reason: 'unreachable' }),
    'Backup: verificarea a eșuat (unreachable).',
    'Backup: check failed (unreachable).',
  ],
  [
    'a job that failed for good',
    entry('job_failed', 'worker', {
      attempts: 5,
      error_code: 'smtp_421',
      job: 'send',
      queue: 'email',
    }),
    'Jobul send din email a eșuat definitiv după 5 încercări (smtp_421).',
    'Job send on email failed for good after 5 attempts (smtp_421).',
  ],
  [
    'a service answering a status',
    entry('service_error', 'email', { provider: 'brevo', status: 429 }),
    'Brevo a răspuns 429.',
    'Brevo answered 429.',
  ],
  [
    'a service answering a reason',
    entry('service_error', 'maps', { provider: 'google', reason: 'timeout' }),
    'Google a răspuns timeout.',
    'Google answered timeout.',
  ],
  [
    'an unexpected server error',
    entry('server_error', 'api', { method: 'GET', route: '/api/v1/garages' }),
    'Eroare neașteptată la GET /api/v1/garages.',
    'Unexpected error on GET /api/v1/garages.',
  ],
  [
    'a deploy',
    entry('deploy', 'worker', { version: 'v1.4.2' }),
    'Versiune nouă instalată: v1.4.2.',
    'Deployed v1.4.2.',
  ],
  [
    'each other source named in the language',
    entry('check_failed', 'identity', { reason: 'x' }),
    'Identitate: verificarea a eșuat (x).',
    'Identity: check failed (x).',
  ],
  [
    'storage named in the language',
    entry('check_failed', 'storage', { reason: 'x' }),
    'Stocare: verificarea a eșuat (x).',
    'Storage: check failed (x).',
  ],
  [
    'worker and WebRTC named as they are',
    entry('check_failed', 'webrtc', { reason: 'x' }),
    'WebRTC: verificarea a eșuat (x).',
    'WebRTC: check failed (x).',
  ],
];

// @traces 298-FR-005
describe('lineOf', () => {
  it.each(CASES)('writes %s in Romanian', async (_, e, ro) => {
    expect(lineOf(e, await i18nIn('ro'))).toBe(ro);
  });

  it.each(CASES)('writes %s in English', async (_, e, __, en) => {
    expect(lineOf(e, await i18nIn('en'))).toBe(en);
  });

  it('writes a completed backup with its time in Bucharest', async () => {
    const e = entry('backup_completed', 'backup', { backup_at: BACKUP_AT });

    expect(lineOf(e, await i18nIn('ro'))).toBe(
      `Backup finalizat la ${formatClock(BACKUP_AT)}.`,
    );
    TestBed.resetTestingModule();
    expect(lineOf(e, await i18nIn('en'))).toBe(
      `Backup completed at ${formatClock(BACKUP_AT)}.`,
    );
    expect(formatClock(BACKUP_AT)).toBe('03:30');
  });

  it('writes a missing backup with the day and time of the last one', async () => {
    const e = entry('backup_failed', 'backup', {
      last_backup_at: LAST_BACKUP,
      reason: 'stale',
    });

    expect(lineOf(e, await i18nIn('ro'))).toBe(
      `Niciun backup din ${formatDay(LAST_BACKUP, 'ro')}, 03:30.`,
    );
    TestBed.resetTestingModule();
    expect(lineOf(e, await i18nIn('en'))).toBe(
      `No backup since ${formatDay(LAST_BACKUP, 'en')}, 03:30.`,
    );
  });

  it('shows the stored message for a kind it does not know', async () => {
    const e = entry('disk_full', 'storage', { free: 0 }, 'Disk full.');

    expect(lineOf(e, await i18nIn('ro'))).toBe('Disk full.');
  });

  it.each([
    [
      'a job failure without its queue',
      entry('job_failed', 'worker', { job: 'send' }, 'Job send failed.'),
    ],
    [
      'a service error without its provider',
      entry('service_error', 'email', { status: 500 }, 'Brevo answered 500.'),
    ],
    [
      'a deploy without its version',
      entry('deploy', 'worker', {}, 'Deployed v9.'),
    ],
    [
      'a tile change without its state',
      entry('status_changed', 'maps', {}, 'Maps: turned amber.'),
    ],
    [
      'a limit for a figure it does not know',
      entry(
        'status_changed',
        'maps',
        { figure: 'heat', limit: 3, state: 'amber' },
        'Maps: heat went above 3.',
      ),
    ],
    [
      'a state it does not know',
      entry(
        'status_changed',
        'maps',
        { state: 'purple' },
        'Maps: turned purple.',
      ),
    ],
  ])('shows the stored message for %s', async (_, e) => {
    expect(lineOf(e, await i18nIn('ro'))).toBe(e.message);
  });

  it('never shows a context field the sentence does not name', async () => {
    const e = entry('server_error', 'api', {
      method: 'POST',
      route: '/api/v1/quotes',
      stack: 'secret-stack',
    });

    expect(lineOf(e, await i18nIn('en'))).not.toContain('secret-stack');
  });
});
