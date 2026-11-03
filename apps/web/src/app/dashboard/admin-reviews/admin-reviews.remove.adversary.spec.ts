import { LiveAnnouncer } from '@angular/cdk/a11y';
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
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';
import type { Mock } from 'vitest';

import { AdminReviews } from './admin-reviews';
import { Live } from '../live';

const HOUR = 3_600_000;
const REMOVED = 'Ștearsă. Autorul și service‑ul au fost anunțați.';

const entry = (n: number, createdAt: string): ReportQueueItemDto => ({
  facts: {
    account: { createdAt: '2026-10-01T08:00:00Z', deleted: false },
    garageReports: { earlier: 0, kept: 0 },
    identicalReviews: 0,
    job: { kind: 'none' },
  },
  garage: { id: `garage-${n}`, name: `Service ${n}` },
  report: {
    createdAt,
    dueAt: '2099-01-01T00:00:00Z',
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

// Report n was made n hours before the test began, so report 1 is the
// newest; every read gives the same times, as the server would.
let base = Date.now();
const queue =
  (total: number, gone: number[] = []) =>
  async (page = 1): Promise<ReportQueueDto> => {
    const all = Array.from({ length: total }, (_, i) =>
      entry(i + 1, new Date(base - (i + 1) * HOUR).toISOString()),
    ).filter((e) => !gone.some((n) => e.report.id === `report-${n}`));
    const rest = all.slice((page - 1) * 20, page * 20);
    return {
      items: rest,
      oldestCreatedAt: all.length
        ? all.reduce((a, b) =>
            a.report.createdAt < b.report.createdAt ? a : b,
          ).report.createdAt
        : null,
      overdue: 0,
      page,
      pageSize: 20,
      total: all.length,
    };
  };

let events: Subject<LiveMessage>;
let answer: (page?: number) => Promise<ReportQueueDto>;
let decision: Mock;

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

async function open(overview = false, language: 'ro' | 'en' = 'ro') {
  events = new Subject();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LiveAnnouncer, useValue: { announce: vi.fn() } },
      { provide: Overlays, useValue: { open: decision } },
      {
        provide: Live,
        useValue: {
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync: new Subject<void>(),
        },
      },
      {
        provide: AdminService,
        useValue: {
          reportQueueControllerList: ({ page }: { page?: number } = {}) =>
            answer(page),
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
const lines = (el: HTMLElement) =>
  items(el).map((i) => text(i.querySelector('[role="status"]')) ?? '');

async function decide(
  el: HTMLElement,
  at: number,
  outcome: unknown = { outcome: 'removed' },
) {
  decision.mockResolvedValueOnce(outcome);
  items(el)[at].querySelector<HTMLButtonElement>('button.remove')?.click();
  await settle();
}

async function reread(read: typeof answer) {
  answer = read;
  events.next({
    at: '2026-10-30T09:00:00.000Z',
    id: 'x',
    kind: 'review.decided',
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  await settle();
}

beforeEach(() => {
  base = Date.now();
  answer = queue(3);
  decision = vi.fn(async () => 'cancelled');
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

// @traces 1423-FR-004
describe('several items this admin decided', () => {
  it('takes two removals off the panel link', async () => {
    answer = queue(8);
    const el = await open(true);

    await decide(el, 0);
    await decide(el, 1);

    expect(text(el.querySelector('a.all'))).toBe('Vezi toate (6)');
  });

  it('counts each removal once through a re-read that lists neither', async () => {
    answer = queue(8);
    const el = await open(true);
    await decide(el, 0);
    await decide(el, 1);

    await reread(queue(8, [1, 2]));

    expect(text(el.querySelector('a.all'))).toBe('Vezi toate (6)');
  });

  it('hides the oldest line once every item is decided', async () => {
    answer = queue(2);
    const el = await open();

    await decide(el, 0);
    await decide(el, 1);

    expect(el.querySelector('.oldest')).toBeNull();
    expect(lines(el)).toEqual([REMOVED, REMOVED]);
  });

  it('leaves the oldest line alone when a newer item is decided', async () => {
    answer = queue(3);
    const el = await open();
    const before = text(el.querySelector('.oldest'));

    await decide(el, 0);

    expect(text(el.querySelector('.oldest'))).toBe(before);
    expect(before).toBe('Cea mai veche raportare așteaptă de 3 ore');
  });

  it('moves the oldest line to the next oldest when the oldest is decided', async () => {
    answer = queue(3);
    const el = await open();

    await decide(el, 2);

    expect(text(el.querySelector('.oldest'))).toBe(
      'Cea mai veche raportare așteaptă de 2 ore',
    );
  });

  it('keeps the oldest line from the undecided items after a re-read drops the decided one', async () => {
    answer = queue(3);
    const el = await open();
    await decide(el, 2);

    await reread(queue(3, [3]));

    expect(text(el.querySelector('.oldest'))).toBe(
      'Cea mai veche raportare așteaptă de 2 ore',
    );
  });

  it('keeps an already-decided item and a gone item in place through a re-read that drops them', async () => {
    answer = queue(3);
    const el = await open();
    await decide(el, 0, { by: 'Ana', outcome: 'already_decided' });
    await decide(el, 1, { outcome: 'gone' });

    await reread(queue(3, [1, 2]));

    expect(items(el)).toHaveLength(3);
    expect(text(items(el)[0].querySelector('.decided'))).toBe(
      'Deja decisă de Ana',
    );
    expect(text(items(el)[1].querySelector('.decided'))).toBe(
      'Raportul nu mai e în așteptare',
    );
    expect(items(el)[2].querySelector('button.remove')).not.toBeNull();
  });

  it('leaves an item another admin decided out after the re-read', async () => {
    answer = queue(3);
    const el = await open();

    await reread(queue(3, [2]));

    expect(items(el)).toHaveLength(2);
  });

  it('keeps a decided item from the second page through More and a re-read', async () => {
    answer = queue(25);
    const el = await open();
    [...el.querySelectorAll('button')]
      .find((b) => text(b) === 'Mai multe')
      ?.click();
    await settle();

    await decide(el, 22);
    await reread(queue(25, [23]));

    expect(lines(el)[22]).toBe(REMOVED);
    expect(items(el)).toHaveLength(25);
  });

  it('keeps the decided item decided with the English line after a re-read', async () => {
    answer = queue(3);
    const el = await open(false, 'en');
    await decide(el, 0);

    await reread(queue(3, [1]));

    expect(lines(el)[0]).toBe('Removed. The author and the garage were told.');
  });

  it('shows the empty state only after every item is gone and More is not pressed', async () => {
    answer = queue(1);
    const el = await open();
    await decide(el, 0);

    expect(el.querySelector('.empty')).toBeNull();
    expect(items(el)).toHaveLength(1);
  });

  it('shows the empty state once a re-read finds none and the item was never decided here', async () => {
    answer = queue(1);
    const el = await open();

    await reread(queue(1, [1]));

    expect(el.querySelector('p.empty')).not.toBeNull();
    expect(items(el)).toHaveLength(0);
  });
});
