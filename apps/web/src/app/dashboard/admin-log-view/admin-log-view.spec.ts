import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type SystemLogDto,
  type SystemLogEntryDto,
} from '@motor-fix/data-access';
import { formatDay, I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminLogView } from './admin-log-view';
import { Live } from '../live';

const VIEW = '/app/admin/log';
const NOW = new Date('2026-10-17T12:00:00.000Z');

type Read = {
  cursor?: string;
  from: string;
  kind?: string[];
  limit?: number;
  q?: string;
  severity?: string[];
  source?: string[];
  to?: string;
};

const entry = (n: number, extra: Partial<SystemLogEntryDto> = {}) =>
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

const page = (
  items: SystemLogEntryDto[],
  nextCursor: string | null = null,
): SystemLogDto => ({ items, nextCursor }) as SystemLogDto;

const failure = () => Promise.reject(new HttpErrorResponse({ status: 500 }));

let reads: Read[];
let answer: (read: Read) => Promise<SystemLogDto>;
let events: Subject<LiveMessage>;
let resync: Subject<void>;
let seen: (() => void) | undefined;

class Observer {
  constructor(private readonly callback: IntersectionObserverCallback) {
    seen = () =>
      this.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      'queueMicrotask',
      'nextTick',
      'setImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
    ],
    now: NOW,
  });
  reads = [];
  seen = undefined;
  answer = async () => page([entry(1)]);
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    Observer;
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener: () => {},
      matches: false,
      media: query,
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(url = VIEW, language: 'ro' | 'en' = 'ro') {
  events = new Subject();
  resync = new Subject();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ component: AdminLogView, path: 'app/admin/log' }]),
      provideLocationMocks(),
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
          systemLogControllerList: (read: Read) => {
            reads.push(read);
            return answer(read);
          },
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const harness = await RouterTestingHarness.create();
  TestBed.inject(Router).setUpLocationChangeListener();
  await harness.navigateByUrl(url);
  document.body.append(harness.fixture.nativeElement);
  await settle();
  return harness.routeNativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const lines = (el: HTMLElement) => [...el.querySelectorAll('mf-log-lines li')];
const sentences = (el: HTMLElement) =>
  lines(el).map((line) => text(line.querySelector('.text')));
const button = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('button')].find((b) => text(b) === name);
const path = () => TestBed.inject(Location).path();
const added = (extra: Record<string, string> = {}): LiveMessage =>
  ({
    at: NOW.toISOString(),
    entryKind: 'deploy',
    id: 'new',
    kind: 'system_log.added',
    severity: 'info',
    source: 'worker',
    ...extra,
  }) as unknown as LiveMessage;
const search = async (el: HTMLElement, value: string) => {
  const box = el.querySelector('input[type="search"]') as HTMLInputElement;
  box.value = value;
  box.dispatchEvent(new Event('input'));
  await new Promise((resolve) => setTimeout(resolve, 350));
  await settle();
};

// @traces 299-FR-007 299-FR-012 299-FR-015
describe('the whole log', () => {
  it('is a region named Jurnal de sistem', async () => {
    const el = await open();

    const region = el.querySelector('section') as HTMLElement;
    const heading = el.querySelector('h2') as HTMLElement;
    expect(text(heading)).toBe('Jurnal de sistem');
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('is named System log in English', async () => {
    const el = await open(VIEW, 'en');

    expect(text(el.querySelector('h2'))).toBe('System log');
  });

  it('reads the last seven days in Bucharest, fifty a page, from the top', async () => {
    await open();

    expect(reads).toEqual([
      {
        from: '2026-10-10T21:00:00.000Z',
        limit: 50,
        to: '2026-10-17T21:00:00.000Z',
      },
    ]);
  });

  it('shows three line skeletons while the first page is read', async () => {
    answer = () => new Promise(() => undefined);
    const el = await open();

    expect(el.querySelectorAll('.skeleton')).toHaveLength(3);
    expect(lines(el)).toHaveLength(0);
  });

  it('groups the lines under one heading per Bucharest day, across its midnight', async () => {
    answer = async () =>
      page([
        entry(1, { at: '2026-10-17T07:40:00.000Z' }),
        entry(2, { at: '2026-10-16T21:05:00.000Z' }),
        entry(3, { at: '2026-10-16T20:55:00.000Z' }),
      ]);
    const el = await open();

    const days = [...el.querySelectorAll('h3')].map(text);
    expect(days).toEqual([
      formatDay('2026-10-17T07:40:00.000Z', 'ro'),
      formatDay('2026-10-16T20:55:00.000Z', 'ro'),
    ]);
    const groups = [...el.querySelectorAll('mf-log-lines')].map(
      (group) => group.querySelectorAll('li').length,
    );
    expect(groups).toEqual([2, 1]);
    expect(lines(el)[1].querySelector('time')?.textContent?.trim()).toBe(
      '00:05',
    );
  });

  it('writes the lines as Jurnal does', async () => {
    const el = await open();

    expect(sentences(el)).toEqual(['Versiune nouă instalată: v1.']);
  });
});

// @traces 299-FR-002 299-FR-007 299-FR-013
describe('the next pages', () => {
  it('reads the next page when the end of the list comes into view, until there is none', async () => {
    answer = async (read) =>
      read.cursor === undefined
        ? page([entry(1)], 'one')
        : read.cursor === 'one'
          ? page([entry(2, { at: '2026-10-15T07:00:00.000Z' })], 'two')
          : page([entry(3, { at: '2026-10-14T07:00:00.000Z' })]);
    const el = await open();

    seen?.();
    await settle();
    seen?.();
    await settle();
    seen?.();
    await settle();

    expect(reads.map((r) => r.cursor)).toEqual([undefined, 'one', 'two']);
    expect(reads[1]).toMatchObject({
      from: '2026-10-10T21:00:00.000Z',
      limit: 50,
      to: '2026-10-17T21:00:00.000Z',
    });
    expect(lines(el)).toHaveLength(3);
  });

  it('shows a skeleton line at the bottom while a further page is read', async () => {
    answer = async (read) =>
      read.cursor === undefined
        ? page([entry(1)], 'one')
        : new Promise(() => undefined);
    const el = await open();

    seen?.();
    await settle();

    expect(lines(el)).toHaveLength(1);
    expect(el.querySelectorAll('.more .skeleton')).toHaveLength(1);
  });

  it('keeps the lines and offers Retry at the bottom when a further page fails', async () => {
    let fail = true;
    answer = async (read) =>
      read.cursor === undefined
        ? page([entry(1)], 'one')
        : fail
          ? failure()
          : page([entry(2)]);
    const el = await open();

    seen?.();
    await settle();

    expect(lines(el)).toHaveLength(1);
    const retry = button(el, 'Reîncearcă') as HTMLButtonElement;
    expect(retry.closest('.more')).not.toBeNull();

    fail = false;
    retry.click();
    await settle();

    expect(lines(el)).toHaveLength(2);
    expect(button(el, 'Reîncearcă')).toBeUndefined();
  });
});

// @traces 299-FR-013 299-FR-015
describe('the states', () => {
  it('announces a failed first read and reads again on Retry', async () => {
    answer = failure;
    const el = await open();

    expect(text(el.querySelector('[role="alert"]'))).toBe(
      'Nu am putut citi jurnalul.',
    );
    answer = async () => page([entry(1)]);
    (button(el, 'Reîncearcă') as HTMLButtonElement).click();
    await settle();

    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(lines(el)).toHaveLength(1);
  });

  it('names the failure in English', async () => {
    answer = failure;
    const el = await open(VIEW, 'en');

    expect(text(el.querySelector('[role="alert"]'))).toBe(
      'Could not read the log.',
    );
    expect(button(el, 'Retry')).toBeDefined();
  });

  it('says there is nothing to show, with no clear button, on the default view', async () => {
    answer = async () => page([]);
    const el = await open();

    expect(text(el)).toContain('Nicio intrare pentru acești filtri.');
    expect(button(el, 'Șterge filtrele')).toBeUndefined();
  });

  it('offers to clear the filters when a filtered read is empty, back to the default view', async () => {
    answer = async () => page([]);
    const el = await open(`${VIEW}?severity=error&q=brevo`);

    expect(text(el)).toContain('Nicio intrare pentru acești filtri.');
    (button(el, 'Șterge filtrele') as HTMLButtonElement).click();
    await settle();

    expect(path()).toBe(VIEW);
    expect(reads.at(-1)).toEqual({
      from: '2026-10-10T21:00:00.000Z',
      limit: 50,
      to: '2026-10-17T21:00:00.000Z',
    });
  });

  it('names the empty answer and the clear button in English', async () => {
    answer = async () => page([]);
    const el = await open(`${VIEW}?kind=backup`, 'en');

    expect(text(el)).toContain('No entries for these filters.');
    expect(button(el, 'Clear the filters')).toBeDefined();
  });
});

// @traces 299-FR-009 299-FR-010
describe('the address', () => {
  it('reads the filters from the address, so a reload gives the same list', async () => {
    await open(
      `${VIEW}?kind=backup&severity=error&source=backup&from=2026-10-01&to=2026-10-03&q=disk`,
    );

    expect(reads).toEqual([
      {
        from: '2026-09-30T21:00:00.000Z',
        kind: ['backup_completed', 'backup_failed'],
        limit: 50,
        q: 'disk',
        severity: ['error'],
        source: ['backup'],
        to: '2026-10-03T21:00:00.000Z',
      },
    ]);
    TestBed.resetTestingModule();
    reads = [];
    await open(
      `${VIEW}?kind=backup&severity=error&source=backup&from=2026-10-01&to=2026-10-03&q=disk`,
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      kind: ['backup_completed', 'backup_failed'],
    });
  });

  it('drops an unknown value from the address and keeps the rest', async () => {
    await open(`${VIEW}?kind=nope&source=email`);

    expect(path()).toBe(`${VIEW}?source=email`);
    expect(reads.at(-1)).toMatchObject({ source: ['email'] });
    expect(reads.at(-1)?.kind).toBeUndefined();
  });

  it('writes the end back when the address names only the start', async () => {
    await open(`${VIEW}?from=2026-10-01`);

    expect(path()).toBe(`${VIEW}?from=2026-10-01&to=2026-10-17`);
  });

  it('writes a filter chosen on the screen to the address', async () => {
    const el = await open();

    const type = el.querySelector('select.type') as HTMLSelectElement;
    type.value = 'jobs';
    type.dispatchEvent(new Event('change'));
    await settle();

    expect(path()).toBe(`${VIEW}?kind=jobs`);
    expect(reads.at(-1)).toMatchObject({ kind: ['job_failed'] });
    expect(reads.at(-1)?.cursor).toBeUndefined();
  });

  // A browser's change event bubbles out of the filter row: it is not a filter.
  it('keeps each filter chosen on the screen as the browser bubbles its change event', async () => {
    const el = await open();

    const type = el.querySelector('select.type') as HTMLSelectElement;
    type.value = 'backup';
    type.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const from = el.querySelector('input.from') as HTMLInputElement;
    from.value = '2026-10-13';
    from.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    await search(el, 'disk');

    expect(path()).toBe(
      `${VIEW}?from=2026-10-13&kind=backup&q=disk&to=2026-10-17`,
    );
    expect(reads.at(-1)).toMatchObject({
      from: '2026-10-12T21:00:00.000Z',
      kind: ['backup_completed', 'backup_failed'],
      q: 'disk',
    });
  });
});

// @traces 299-FR-011
describe('the search', () => {
  it('sends nothing under two characters', async () => {
    const el = await open();

    await search(el, ' a ');

    expect(reads).toHaveLength(1);
    expect(path()).toBe(VIEW);
  });

  it('reads the trimmed text after the wait and writes it to the address', async () => {
    const el = await open();

    await search(el, ' brevo ');

    expect(reads.at(-1)).toMatchObject({ q: 'brevo' });
    expect(path()).toBe(`${VIEW}?q=brevo`);
  });

  // Enter in the box, or its clear button, fires a bubbling search event.
  it('keeps the search when the box fires the browser search event', async () => {
    const el = await open();
    await search(el, 'brevo');
    const before = reads.length;

    el.querySelector('input[type="search"]')?.dispatchEvent(
      new Event('search', { bubbles: true }),
    );
    await settle();

    expect(path()).toBe(`${VIEW}?q=brevo`);
    expect(reads).toHaveLength(before);
  });

  it('drops the answer of an older read when a newer one is on its way', async () => {
    let first: (log: SystemLogDto) => void = () => undefined;
    answer = async (read) =>
      read.q === 'bre'
        ? new Promise((resolve) => (first = resolve))
        : read.q === 'brevo'
          ? page([entry(2)])
          : page([entry(1)]);
    const el = await open();

    await search(el, 'bre');
    await search(el, 'brevo');
    first(page([entry(9)]));
    await settle();

    expect(sentences(el)).toEqual(['Versiune nouă instalată: v2.']);
  });
});

// @traces 299-FR-014 299-FR-015
describe('the new entries bar', () => {
  const bar = (el: HTMLElement) =>
    el.querySelector('[aria-live="polite"] button');

  it('counts each matching entry without moving the list', async () => {
    const el = await open();

    expect(bar(el)).toBeNull();
    expect(el.querySelector('[aria-live="polite"]')).not.toBeNull();
    events.next(added());
    await settle();
    expect(text(bar(el))).toBe('1 intrare nouă');

    events.next(added());
    events.next(added());
    await settle();
    expect(text(bar(el))).toBe('3 intrări noi');
    expect(reads).toHaveLength(1);
    expect(lines(el)).toHaveLength(1);
  });

  it('counts in English', async () => {
    const el = await open(VIEW, 'en');

    events.next(added());
    await settle();
    expect(text(bar(el))).toBe('1 new entry');
    events.next(added());
    await settle();
    expect(text(bar(el))).toBe('2 new entries');
  });

  it('re-reads from the top on a tap and hides itself', async () => {
    answer = async (read) =>
      read.cursor === undefined ? page([entry(1)], 'one') : page([entry(2)]);
    const el = await open();
    seen?.();
    await settle();

    answer = async () => page([entry(3), entry(1)], 'one');
    events.next(added());
    await settle();
    (bar(el) as HTMLButtonElement).click();
    await settle();

    expect(reads.at(-1)?.cursor).toBeUndefined();
    expect(reads).toHaveLength(3);
    expect(bar(el)).toBeNull();
    expect(sentences(el)).toEqual([
      'Versiune nouă instalată: v3.',
      'Versiune nouă instalată: v1.',
    ]);
  });

  it('stays hidden when the range ends before today', async () => {
    const el = await open(`${VIEW}?from=2026-10-10&to=2026-10-16`);

    events.next(added());
    await settle();

    expect(bar(el)).toBeNull();
  });

  it.each([
    ['type', 'kind=backup', { entryKind: 'deploy' }],
    ['severity', 'severity=error', { severity: 'warning' }],
    ['source', 'source=email', { source: 'worker' }],
  ])(
    'stays hidden for an entry its %s filter leaves out',
    async (_, query, extra) => {
      const el = await open(`${VIEW}?${query}`);

      events.next(added(extra));
      await settle();

      expect(bar(el)).toBeNull();
    },
  );

  it('ignores live events of other kinds', async () => {
    const el = await open();

    events.next({ ...added(), kind: 'garage.approved' } as LiveMessage);
    await settle();

    expect(bar(el)).toBeNull();
  });

  it('re-reads from the top on a reconnect', async () => {
    answer = async (read) =>
      read.cursor === undefined ? page([entry(1)], 'one') : page([entry(2)]);
    await open();
    seen?.();
    await settle();

    resync.next();
    await settle();

    expect(reads.map((r) => r.cursor)).toEqual([undefined, 'one', undefined]);
  });

  it('never polls', async () => {
    const every = jest.spyOn(globalThis, 'setInterval');
    await open();

    expect(every).not.toHaveBeenCalled();
  });
});
