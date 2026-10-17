import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type SystemLogDto,
  type SystemLogEntryDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminLog } from './admin-log';
import { lineOf } from './admin-log.line';
import { Live } from '../live';

const entry = (
  n: number,
  extra: Record<string, unknown> = {},
): SystemLogEntryDto =>
  ({
    at: '2026-10-17T07:40:00.000Z',
    context: { version: `v${n}` },
    count: 1,
    id: `entry-${n}`,
    kind: 'deploy',
    message: `Deployed v${n}.`,
    severity: 'info',
    source: 'worker',
    ...extra,
  }) as SystemLogEntryDto;

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let asked: { from: string; limit?: number }[];
let answer: () => Promise<SystemLogDto>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  events = new Subject();
  resync = new Subject();
  asked = [];
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync,
        },
      },
      {
        provide: AdminService,
        useValue: {
          systemLogControllerList: (read: { from: string; limit?: number }) => {
            asked.push(read);
            return answer();
          },
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(AdminLog);
  document.body.append(fixture.nativeElement);
  await settle();
  return { element: fixture.nativeElement as HTMLElement, fixture, i18n };
}

const lines = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('ol > li'),
];

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
  jest.useRealTimers();
});

const BROKEN = /undefined|null|NaN|\[object|\{|\}|Infinity/;

// @traces 298-FR-005
describe('lineOf with hostile context', () => {
  const cases: [string, SystemLogEntryDto][] = [
    ['a null context', entry(1, { context: null, kind: 'service_error' })],
    [
      'a string limit',
      entry(2, {
        context: { figure: 'latency_ms', limit: '1500', state: 'amber' },
        kind: 'status_changed',
        source: 'maps',
      }),
    ],
    [
      'a negative limit',
      entry(3, {
        context: { figure: 'latency_ms', limit: -5, state: 'amber' },
        kind: 'status_changed',
        source: 'maps',
      }),
    ],
    [
      'a NaN limit',
      entry(4, {
        context: { figure: 'failed_share', limit: Number.NaN, state: 'red' },
        kind: 'status_changed',
        source: 'maps',
      }),
    ],
    [
      'a null limit',
      entry(5, {
        context: { figure: 'backup_age_h', limit: null, state: 'red' },
        kind: 'status_changed',
        source: 'backup',
      }),
    ],
    [
      'a numeric version',
      entry(6, { context: { version: 123 }, kind: 'deploy' }),
    ],
    [
      'an unparseable backup time',
      entry(7, {
        context: { backup_at: 'yesterday' },
        kind: 'backup_completed',
        source: 'backup',
      }),
    ],
    [
      'a null backup time',
      entry(8, {
        context: { backup_at: null },
        kind: 'backup_completed',
        source: 'backup',
      }),
    ],
    [
      'an unparseable last backup',
      entry(9, {
        context: { last_backup_at: 'never', reason: 'stale' },
        kind: 'backup_failed',
        source: 'backup',
      }),
    ],
    [
      'a missing last backup',
      entry(10, {
        context: { reason: 'stale' },
        kind: 'backup_failed',
        source: 'backup',
      }),
    ],
    [
      'a source the panel does not name',
      entry(11, {
        context: { reason: 'x' },
        kind: 'check_failed',
        source: 'kernel',
      }),
    ],
    [
      'an object as the route',
      entry(12, {
        context: { method: 'GET', route: { a: 1 } },
        kind: 'server_error',
        source: 'api',
      }),
    ],
    [
      'an empty provider',
      entry(13, {
        context: { provider: '', status: 500 },
        kind: 'service_error',
        source: 'email',
      }),
    ],
    [
      'a provider and neither status nor reason',
      entry(14, {
        context: { provider: 'brevo' },
        kind: 'service_error',
        source: 'email',
      }),
    ],
    [
      'zero attempts as a string',
      entry(15, {
        context: {
          attempts: '5',
          error_code: 'x',
          job: 'send',
          queue: 'email',
        },
        kind: 'job_failed',
        source: 'worker',
      }),
    ],
  ];

  it.each(cases)('never writes a broken sentence for %s', async (_, e) => {
    TestBed.configureTestingModule({});
    const i18n = TestBed.inject(I18n);
    await i18n.enter('admin');

    const text = lineOf(e, i18n);

    expect(text === e.message || !BROKEN.test(text)).toBe(true);
    expect(text).not.toBe('');
  });

  it('does not read a prototype key as a context figure', async () => {
    TestBed.configureTestingModule({});
    const i18n = TestBed.inject(I18n);
    await i18n.enter('admin');
    const e = entry(1, {
      context: JSON.parse('{"__proto__":{"version":"evil"}}'),
    });

    expect(lineOf(e, i18n)).toBe('Deployed v1.');
  });

  it('keeps markup in a context value as plain text in the line', async () => {
    answer = async () => ({
      items: [
        entry(1, {
          context: { method: 'GET', route: '/<img src=x onerror=alert(1)>' },
          kind: 'server_error',
          source: 'api',
        }),
      ],
    });
    const { element } = await open();

    expect(element.querySelector('img')).toBeNull();
    expect(lines(element)[0].textContent).toContain('<img src=x');
  });
});

describe('AdminLog under odd answers', () => {
  // @traces 298-FR-007
  it.each([0, -3])('shows no count mark for a count of %s', async (count) => {
    answer = async () => ({ items: [entry(1, { count })] });
    const { element } = await open();

    expect(element.querySelector('.count')).toBeNull();
  });

  // @traces 298-FR-007
  it('reads a count of 1000 as ×1000 and "de 1000 de ori"', async () => {
    answer = async () => ({ items: [entry(1, { count: 1000 })] });
    const { element } = await open();

    expect(element.querySelector('.count [aria-hidden]')?.textContent).toBe(
      '×1000',
    );
    expect(element.querySelector('.count .sr-only')?.textContent?.trim()).toBe(
      'de 1000 de ori',
    );
  });

  // @traces 298-FR-005 298-FR-006
  it('shows a line, in grey with the Info word, for a severity it does not know', async () => {
    answer = async () => ({ items: [entry(1, { severity: 'fatal' })] });
    const { element } = await open();

    const row = lines(element);
    expect(row).toHaveLength(1);
    expect(row[0].querySelector('mf-lamp')?.textContent?.trim()).not.toBe('');
  });

  // @traces 298-FR-004
  it('shows a time for an entry whose instant is unreadable without a broken clock', async () => {
    answer = async () => ({ items: [entry(1, { at: 'not a date' })] });
    const { element } = await open();

    expect(lines(element)[0].querySelector('time')?.textContent).not.toMatch(
      BROKEN,
    );
  });

  // @traces 298-FR-003
  it('lists twenty-one answered entries without inventing a link', async () => {
    answer = async () => ({
      items: Array.from({ length: 21 }, (_, i) => entry(i + 1)),
    });
    const { element } = await open();

    expect(element.querySelector('a, button')).toBeNull();
  });

  // @traces 298-FR-015
  it('keeps the previous lines when a re-read answers an empty log after a failure', async () => {
    answer = async () => ({ items: [entry(1)] });
    const { element } = await open();
    answer = () => Promise.reject(new Error('down'));
    resync.next();
    await settle();
    resync.next();
    await settle();

    expect(lines(element)).toHaveLength(1);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 298-FR-015
  it('shows the failed state again when Retry fails again, and no skeleton remains', async () => {
    answer = () => Promise.reject(new Error('down'));
    const { element } = await open();

    (element.querySelector('button') as HTMLButtonElement).click();
    await settle();

    expect(asked).toHaveLength(2);
    expect(element.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Nu am putut citi jurnalul.',
    );
    expect(element.querySelectorAll('.skeleton')).toHaveLength(0);
  });

  // @traces 298-FR-009
  it('reads nothing after the panel is destroyed, on an event, a resync or a poll', async () => {
    answer = async () => ({ items: [entry(1)] });
    const { fixture } = await open();
    fixture.destroy();

    events.next({
      at: new Date().toISOString(),
      id: 'x',
      kind: 'system_log.added',
    } as unknown as LiveMessage);
    resync.next();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(asked).toHaveLength(1);
  });

  // @traces 298-FR-009
  it('does not pile reads up when ten entries arrive in a burst', async () => {
    answer = async () => ({ items: [entry(1)] });
    await open();

    for (let i = 0; i < 10; i++) {
      events.next({
        at: new Date().toISOString(),
        id: `n${i}`,
        kind: 'system_log.added',
      } as unknown as LiveMessage);
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    await settle();

    expect(asked.length).toBeLessThanOrEqual(3);
  });

  // @traces 298-FR-010
  it('reads nothing after the panel is destroyed when midnight passes', async () => {
    jest.useFakeTimers({
      doNotFake: ['setImmediate'],
      now: new Date('2026-10-17T20:59:00Z'),
    });
    answer = async () => ({ items: [] });
    const opening = open();
    await jest.advanceTimersByTimeAsync(50);
    const { fixture } = await opening;
    fixture.destroy();

    await jest.advanceTimersByTimeAsync(3 * 3_600_000);

    expect(asked).toHaveLength(1);
  });

  // @traces 298-FR-010
  it('re-reads once at the end of the 25-hour day the clocks go back, not an hour early', async () => {
    jest.useFakeTimers({
      doNotFake: ['setImmediate'],
      now: new Date('2026-10-24T20:59:00Z'),
    });
    answer = async () => ({ items: [] });
    const opening = open();
    await jest.advanceTimersByTimeAsync(50);
    await opening;

    await jest.advanceTimersByTimeAsync(62_000);
    expect(asked.map((a) => a.from)).toEqual([
      '2026-10-23T21:00:00.000Z',
      '2026-10-24T21:00:00.000Z',
    ]);

    await jest.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(asked).toHaveLength(2);

    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(asked.at(-1)?.from).toBe('2026-10-25T22:00:00.000Z');
    expect(asked).toHaveLength(3);
  });

  // @traces 298-FR-005
  it('names a grouped entry in English with the count in words', async () => {
    answer = async () => ({ items: [entry(1, { count: 2 })] });
    const { element } = await open('en');

    expect(element.querySelector('.count .sr-only')?.textContent?.trim()).toBe(
      '2 times',
    );
  });
});
