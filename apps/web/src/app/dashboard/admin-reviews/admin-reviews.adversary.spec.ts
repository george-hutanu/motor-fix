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

afterEach(() => TestBed.resetTestingModule());

// @traces 1389-FR-001
describe('the queue view at its limits', () => {
  it('shows exactly 20 items with no More button when the total is 20', async () => {
    answer = queue(20);
    const el = await open();

    expect(items(el).length).toBe(20);
    expect(button(el, 'Mai multe')).toBeUndefined();
  });

  it('shows More when the total is 21, and appends the one item on pressing it', async () => {
    answer = queue(21);
    const el = await open();
    expect(items(el).length).toBe(20);

    button(el, 'Mai multe')?.click();
    await settle();

    expect(items(el).length).toBe(21);
    expect(button(el, 'Mai multe')).toBeUndefined();
    expect(asked.at(-1)).toBe(2);
  });

  it('keeps the items and More when reading the next page fails, and shows no error', async () => {
    answer = queue(30);
    const el = await open();
    const ok = answer;
    answer = async (page) => {
      if (page === 2) throw new HttpErrorResponse({ status: 503 });
      return ok(page);
    };

    button(el, 'Mai multe')?.click();
    await settle();

    expect(items(el).length).toBe(20);
    expect(button(el, 'Mai multe')).toBeDefined();
    expect(text(el)).not.toContain('Nu am putut citi');
  });

  it('shows the error state for a 403 first read as well as for a 500', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 403 });
    };
    const el = await open();

    expect(text(el)).toContain('Nu am putut citi recenziile raportate.');
    expect(button(el, 'Reîncearcă')).toBeDefined();
  });

  it('recovers to the list after a failed first read and a successful retry', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 500 });
    };
    const el = await open();

    answer = queue(2);
    button(el, 'Reîncearcă')?.click();
    await settle();

    expect(items(el).length).toBe(2);
    expect(text(el)).not.toContain('Nu am putut citi');
  });

  it('shows the empty state, not the error, for a read that answers no items and a null oldest', async () => {
    answer = async () => ({
      items: [],
      oldestCreatedAt: null,
      overdue: 0,
      page: 1,
      pageSize: 20,
      total: 0,
    });
    const el = await open();

    expect(text(el)).toContain('Nicio recenzie raportată.');
    expect(text(el)).not.toContain('Cea mai veche');
  });

  it('keeps no More button when a page shrinks to the shown items under a live re-read', async () => {
    answer = queue(30);
    const el = await open();
    button(el, 'Mai multe')?.click();
    await settle();
    expect(items(el).length).toBe(30);

    answer = queue(20);
    events.next(message('review.decided'));
    await new Promise((r) => setTimeout(r, 400));
    await settle();

    expect(items(el).length).toBe(20);
    expect(button(el, 'Mai multe')).toBeUndefined();
  });

  it.each([
    [59_000, 'sub un minut'],
    [60_000, '1 minut'],
    [HOUR, '1 oră'],
    [24 * HOUR - 5000, '23 de ore'],
    [24 * HOUR, '1 zi'],
  ])('words an oldest report %p ms old as %p', async (ms, age) => {
    answer = queue(1, new Date(Date.now() - ms).toISOString());
    const el = await open();

    expect(text(el)).toContain(`Cea mai veche raportare așteaptă de ${age}`);
  });

  it('counts the total, not the page, in the panel link', async () => {
    answer = queue(1000);
    const el = await open({ overview: true });

    expect(items(el).length).toBe(5);
    expect(text(el)).toMatch(/Vezi toate \(1\.?000\)/);
  });

  it('shows six items as five and a link to six', async () => {
    answer = queue(6);
    const el = await open({ overview: true });

    expect(items(el).length).toBe(5);
    expect(text(el)).toContain('Vezi toate (6)');
  });

  it('shows five items and no link at exactly five', async () => {
    answer = queue(5);
    const el = await open({ overview: true });

    expect(items(el).length).toBe(5);
    expect(text(el)).not.toContain('Vezi toate');
  });

  it('shows one item and no link or More at one', async () => {
    answer = queue(1);
    const el = await open();

    expect(items(el).length).toBe(1);
    expect(button(el, 'Mai multe')).toBeUndefined();
  });
});

// @traces 1389-FR-006
describe('the queue view under live events in odd orders', () => {
  it('shows no skeletons while a live re-read is slow', async () => {
    answer = queue(3);
    const el = await open();
    answer = () => new Promise(() => undefined);

    events.next(message('review.reported'));
    await new Promise((r) => setTimeout(r, 400));
    await settle();

    expect(items(el).length).toBe(3);
    expect(
      el.querySelector('.skeleton, mf-skeleton, [class*="skeleton"]'),
    ).toBeNull();
  });

  it('reads once for a burst of mixed review kinds', async () => {
    answer = queue(3);
    await open();
    asked.length = 0;

    for (const kind of [
      'review.reported',
      'review.decided',
      'review.deleted',
      'review.report_closed',
    ] as EventKind[]) {
      events.next(message(kind));
    }
    await new Promise((r) => setTimeout(r, 450));
    await settle();

    expect(asked).toEqual([1]);
  });

  it('drops the item a decided event removed and keeps the others', async () => {
    answer = queue(3);
    const el = await open();

    answer = async (page = 1) => {
      const full = await queue(3)(page);
      return { ...full, items: full.items.slice(1), total: 2 };
    };
    events.next(message('review.decided'));
    await new Promise((r) => setTimeout(r, 400));
    await settle();

    expect(articles(el).map((a) => a.getAttribute('aria-label'))).toEqual([
      'Service 2 · recenzie de 2,0',
      'Service 3 · recenzie de 2,0',
    ]);
  });

  it('shows the new item when the queue went from empty to one on a reported event', async () => {
    answer = queue(0);
    const el = await open();
    expect(text(el)).toContain('Nicio recenzie raportată.');

    answer = queue(1);
    events.next(message('review.reported'));
    await new Promise((r) => setTimeout(r, 400));
    await settle();

    expect(items(el).length).toBe(1);
    expect(text(el)).not.toContain('Nicio recenzie raportată.');
  });

  it('reads nothing for events of other kinds that sound alike', async () => {
    answer = queue(1);
    await open();
    asked.length = 0;

    for (const kind of [
      'review.posted',
      'review.replied',
      'request.created',
    ] as EventKind[]) {
      events.next(message(kind));
    }
    await new Promise((r) => setTimeout(r, 450));

    expect(asked).toEqual([]);
  });

  it('reads again on resync even while the first read has failed, and recovers', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 500 });
    };
    const el = await open();

    answer = queue(2);
    resync.next();
    await new Promise((r) => setTimeout(r, 400));
    await settle();

    expect(items(el).length).toBe(2);
  });

  it('does not read again after the view is destroyed', async () => {
    answer = queue(1);
    const el = await open();
    TestBed.resetTestingModule();
    el.remove();
    asked.length = 0;

    events.next(message('review.reported'));
    await new Promise((r) => setTimeout(r, 400));

    expect(asked).toEqual([]);
  });
});
