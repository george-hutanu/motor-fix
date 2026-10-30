import { LiveAnnouncer } from '@angular/cdk/a11y';
import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type ReportQueueDto,
  type ReportQueueItemDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminReviews } from './admin-reviews';
import { Live } from '../live';

// @traces 1389-FR-001 1389-FR-002 1389-FR-005 1389-FR-006 1389-FR-008 1389-FR-009

const HOUR = 3_600_000;

const entry = (
  n: number,
  dueAt = '2099-01-01T00:00:00Z',
): ReportQueueItemDto => ({
  facts: {
    account: { createdAt: '2026-10-01T08:00:00Z', deleted: false },
    garageReports: { earlier: 0, kept: 0 },
    identicalReviews: 0,
    job: { kind: 'none' },
  },
  garage: { id: `garage-${n}`, name: `Service ${n}` },
  report: {
    createdAt: '2026-10-29T09:00:00Z',
    dueAt,
    id: `report-${n}`,
    overdue: false,
    reason: 'insults',
    source: 'garage',
    target: 'review',
  },
  review: {
    author: 'Andrei P.',
    id: `review-${n}`,
    postedAt: '2026-10-28T10:00:00Z',
    score: 2,
    source: 'profile',
    text: `Recenzia ${n}`,
  },
});

// A queue of `total` items, 20 a page, as the server pages it.
const queue =
  (total: number, oldest: string | null = new Date().toISOString()) =>
  async (page = 1): Promise<ReportQueueDto> => ({
    items: Array.from(
      { length: Math.max(0, Math.min(20, total - (page - 1) * 20)) },
      (_, i) => entry((page - 1) * 20 + i + 1),
    ),
    oldestCreatedAt: total ? oldest : null,
    overdue: 0,
    page,
    pageSize: 20,
    total,
  });

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let asked: number[];
let announce: jest.Mock;
let answer: (page?: number) => Promise<ReportQueueDto>;

async function settle() {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

@Component({
  imports: [AdminReviews],
  template: '<mf-admin-reviews overview />',
})
class Overview {}

async function open(
  { overview = false }: { overview?: boolean } = {},
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  resync = new Subject();
  asked = [];
  announce = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LiveAnnouncer, useValue: { announce } },
      {
        provide: Live,
        useValue: {
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
          reportQueueControllerList: ({ page }: { page?: number } = {}) => {
            asked.push(page ?? 1);
            return answer(page);
          },
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(overview ? Overview : AdminReviews);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const items = (el: HTMLElement) => [
  ...el.querySelectorAll('mf-admin-review-item'),
];
const articles = (el: HTMLElement) => [...el.querySelectorAll('article')];
const button = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('button')].find((b) => text(b) === name);
const message = (kind: EventKind): LiveMessage => ({
  at: '2026-10-30T09:00:00.000Z',
  id: 'any-review',
  kind,
});

beforeEach(() => {
  answer = queue(3);
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

describe('the reported reviews view', () => {
  it('heads the list and draws every item, oldest first', async () => {
    const el = await open();

    expect(text(el.querySelector('h2'))).toBe('Recenzii raportate');
    expect(items(el)).toHaveLength(3);
    expect(articles(el).map((a) => a.getAttribute('aria-label'))).toEqual([
      'Service 1 · recenzie de 2,0',
      'Service 2 · recenzie de 2,0',
      'Service 3 · recenzie de 2,0',
    ]);
  });

  it.each([
    [2 * 24 * HOUR + HOUR, 'ro', 'Cea mai veche raportare așteaptă de 2 zile'],
    [24 * HOUR, 'ro', 'Cea mai veche raportare așteaptă de 1 zi'],
    [5 * HOUR, 'en', 'The oldest report has waited 5 hours'],
    [3 * 60_000, 'ro', 'Cea mai veche raportare așteaptă de 3 minute'],
    [10_000, 'en', 'The oldest report has waited under a minute'],
  ] as const)(
    'says how long the oldest report has waited: %p ms in %s',
    async (age, language, line) => {
      answer = queue(1, new Date(Date.now() - age).toISOString());
      const el = await open({}, language);

      expect(text(el.querySelector('.oldest'))).toBe(line);
    },
  );

  it('says so when nothing is reported, with no oldest line', async () => {
    answer = queue(0);
    const el = await open();

    expect(text(el.querySelector('.empty'))).toBe('Nicio recenzie raportată.');
    expect(el.querySelector('.oldest')).toBeNull();
    expect(items(el)).toHaveLength(0);
  });

  it('says so in English', async () => {
    answer = queue(0);
    const el = await open({}, 'en');

    expect(text(el.querySelector('.empty'))).toBe('No reported reviews.');
  });

  it('shows skeleton rows while the first read is on its way', async () => {
    answer = () => new Promise(() => undefined);
    const el = await open();

    expect(el.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0);
    expect(el.querySelector('ul')?.getAttribute('aria-busy')).toBe('true');
  });

  it('offers a retry when the first read fails, and reads again on it', async () => {
    answer = () => Promise.reject(new HttpErrorResponse({ status: 500 }));
    const el = await open();

    expect(text(el.querySelector('.failed p'))).toBe(
      'Nu am putut citi recenziile raportate.',
    );
    expect(el.querySelector('.failed')?.getAttribute('role')).toBe('alert');
    answer = queue(2);
    button(el, 'Reîncearcă')?.click();
    await settle();

    expect(items(el)).toHaveLength(2);
    expect(el.querySelector('.failed')).toBeNull();
  });

  it('words the failed read in English', async () => {
    answer = () => Promise.reject(new HttpErrorResponse({ status: 500 }));
    const el = await open({}, 'en');

    expect(text(el.querySelector('.failed p'))).toBe(
      'Could not read the reported reviews.',
    );
    expect(button(el, 'Retry')).toBeDefined();
  });

  it('keeps the items shown when a re-read fails', async () => {
    const el = await open();
    answer = () => Promise.reject(new HttpErrorResponse({ status: 503 }));
    resync.next();
    await settle();

    expect(items(el)).toHaveLength(3);
    expect(el.querySelector('.failed p')).toBeNull();
  });

  it('lists 20, and More appends the next page and moves focus to its first item', async () => {
    answer = queue(25);
    const el = await open();

    expect(items(el)).toHaveLength(20);
    button(el, 'Mai multe')?.click();
    await settle();

    expect(items(el)).toHaveLength(25);
    expect(asked).toEqual([1, 1, 2]);
    expect(button(el, 'Mai multe')).toBeUndefined();
    expect(document.activeElement).toBe(articles(el)[20]);
  });

  it('reads every page shown again on a live re-read, keeping the items', async () => {
    answer = queue(25);
    const el = await open();
    button(el, 'Mai multe')?.click();
    await settle();
    asked = [];

    events.next(message('review.reported'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect([...asked].sort()).toEqual([1, 2]);
    expect(items(el)).toHaveLength(25);
  });

  it('shows one item once when a page shifts under a re-read', async () => {
    answer = queue(25);
    const el = await open();
    const shifted = queue(25);
    answer = async (page = 1) => {
      const read = await shifted(page);
      return page === 2 ? { ...read, items: [entry(20), ...read.items] } : read;
    };
    button(el, 'Mai multe')?.click();
    await settle();

    const ids = articles(el).map((a) => a.getAttribute('aria-label'));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the reported reviews panel on the overview', () => {
  it('shows the five oldest and a link to the whole view with the total', async () => {
    answer = queue(7);
    const el = await open({ overview: true });

    expect(items(el)).toHaveLength(5);
    const all = el.querySelector('a.all');
    expect(text(all)).toBe('Vezi toate (7)');
    expect(all?.getAttribute('href')).toBe('/app/admin/reviews');
    expect(button(el, 'Mai multe')).toBeUndefined();
    expect(el.querySelector('.oldest')).toBeNull();
  });

  it('links in English', async () => {
    answer = queue(7);
    const el = await open({ overview: true }, 'en');

    expect(text(el.querySelector('a.all'))).toBe('See all (7)');
  });

  it('has no link when every item is shown', async () => {
    answer = queue(5);
    const el = await open({ overview: true });

    expect(items(el)).toHaveLength(5);
    expect(el.querySelector('a.all')).toBeNull();
  });

  it('says so when nothing is reported', async () => {
    answer = queue(0);
    const el = await open({ overview: true });

    expect(text(el.querySelector('.empty'))).toBe('Nicio recenzie raportată.');
  });

  it('reads page 1 only', async () => {
    answer = queue(45);
    await open({ overview: true });

    expect(asked).toEqual([1]);
  });
});

describe('live', () => {
  it.each<EventKind>([
    'review.reported',
    'review.decided',
    'review.deleted',
    'review.report_closed',
  ])('reads again on %s, with no skeleton in between', async (kind) => {
    const el = await open();
    let finish: (() => void) | undefined;
    answer = (page) =>
      new Promise((resolve) => {
        finish = () => void queue(4)(page).then(resolve);
      });

    events.next(message(kind));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();
    expect(asked).toHaveLength(2);
    expect(el.querySelectorAll('.skeleton-row')).toHaveLength(0);
    expect(items(el)).toHaveLength(3);

    finish?.();
    await settle();
    expect(items(el)).toHaveLength(4);
  });

  it('reads nothing on another review kind', async () => {
    await open();

    events.next(message('review.posted'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(asked).toHaveLength(1);
  });

  it('reads once for the events of 300 ms', async () => {
    await open();

    events.next(message('review.reported'));
    events.next(message('review.decided'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(asked).toHaveLength(2);
  });

  it('reads again when the connection comes back', async () => {
    await open();

    resync.next();
    await settle();

    expect(asked).toHaveLength(2);
  });

  it('announces the pending count politely when it changes, not when it first shows', async () => {
    await open();
    expect(announce).not.toHaveBeenCalled();

    answer = queue(4);
    resync.next();
    await settle();

    expect(announce).toHaveBeenCalledWith(
      '4 recenzii raportate în așteptare',
      'polite',
    );
  });

  it('announces one in the singular, in English too', async () => {
    await open({}, 'en');

    answer = queue(1);
    resync.next();
    await settle();

    expect(announce).toHaveBeenCalledWith(
      '1 reported review pending',
      'polite',
    );
  });

  it('moves no focus to an item a later re-read adds after More brought nothing', async () => {
    answer = queue(25);
    const el = await open();
    answer = queue(20);
    button(el, 'Mai multe')?.click();
    await settle();
    const before = document.activeElement;

    answer = queue(25);
    resync.next();
    await settle();

    expect(items(el)).toHaveLength(25);
    expect(document.activeElement).toBe(before);
  });

  it('moves no focus when an item arrives', async () => {
    const el = await open();
    const before = document.activeElement;

    answer = queue(4);
    resync.next();
    await settle();

    expect(items(el)).toHaveLength(4);
    expect(document.activeElement).toBe(before);
  });
});

describe('the time on screen', () => {
  it('leaves a mark days away to the minute tick, setting no timer for it', async () => {
    const timeout = jest.spyOn(globalThis, 'setTimeout');
    try {
      answer = async () => ({
        ...(await queue(1)()),
        items: [entry(1, '2126-10-30T10:00:00Z')],
      });
      await open();

      const far = timeout.mock.calls.filter(([, ms]) => (ms ?? 0) > 60_000);
      expect(far).toEqual([]);
    } finally {
      timeout.mockRestore();
    }
  });

  it('marks an item past 48 hours when it crosses the mark while shown, with no new read', async () => {
    jest.useFakeTimers({
      advanceTimers: true,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      now: new Date('2026-10-30T10:00:00Z'),
    });
    try {
      answer = async () => ({
        ...(await queue(1)()),
        items: [entry(1, '2026-10-30T10:00:30Z')],
      });
      const el = await open();
      expect(el.querySelector('.overdue')).toBeNull();

      jest.setSystemTime(new Date('2026-10-30T10:00:31Z'));
      jest.advanceTimersByTime(31_000);
      await settle();

      expect(text(el.querySelector('.overdue'))).toBe('Peste 48 de ore');
      expect(asked).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
