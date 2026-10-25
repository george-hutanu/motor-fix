import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type GarageStaffReviewsPageDto,
  type MeDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { GarageReviewsPanel } from './garage-reviews-panel';
import { Live } from '../../live';
import { Session } from '../../session';
import { staffPage, staffReview } from '../garage-reviews.testing';

const GARAGE = 'garage-1';

const me = () =>
  ({
    capabilities: ['garage.reviews'],
    garageAccess: [{ garageId: GARAGE, role: 'owner', status: 'approved' }],
    garageId: GARAGE,
  }) as unknown as MeDto;

@Component({
  imports: [GarageReviewsPanel],
  template: `<mf-garage-reviews-panel [limit]="limit" />`,
})
class Host {
  limit: number | undefined = undefined;
}

let events: Subject<LiveMessage>;
let read: jest.Mock;

const rows = (count: number, from = 1) =>
  Array.from({ length: count }, (_, i) => staffReview({ id: `r-${from + i}` }));

async function render({
  answer = async () => staffPage(),
  limit,
}: {
  answer?: (query: {
    garageId: string;
    page: number;
  }) => Promise<GarageStaffReviewsPageDto>;
  limit?: number;
} = {}) {
  events = new Subject();
  const resync = new Subject<void>();
  read = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: ReviewsService,
        useValue: { garageReviewsControllerRead: read },
      },
      { provide: Session, useValue: { shown: signal(me()) } },
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
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.limit = limit;
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { element, fixture, settle };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const shown = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('article[mf-garage-review-row]'),
];
const moreButton = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === 'Vezi mai multe',
  );
const message = (kind: string): LiveMessage => ({
  at: '2026-10-25T12:00:00.000Z',
  id: 'r-9',
  kind,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => TestBed.resetTestingModule());

// @traces 074-FR-001
describe('Recenzii noi at its edges', () => {
  it('shows one review when the limit is one', async () => {
    const { element, settle } = await render({
      answer: async () => staffPage({ items: rows(7) }),
      limit: 1,
    });
    await settle();

    expect(shown(element).map((r) => r.dataset['liveId'])).toEqual(['r-1']);
  });

  it('shows all that came when the limit is above the count', async () => {
    const { element, settle } = await render({
      answer: async () => staffPage({ items: rows(2), total: 2 }),
      limit: 5,
    });
    await settle();

    expect(shown(element)).toHaveLength(2);
  });

  it('shows exactly five when the read holds exactly five', async () => {
    const { element, settle } = await render({
      answer: async () => staffPage({ items: rows(5), total: 5 }),
      limit: 5,
    });
    await settle();

    expect(shown(element)).toHaveLength(5);
  });
});

// @traces 074-FR-002
describe('the Recenzii view at its edges', () => {
  it('draws no more button when the last page holds exactly 20 of 20', async () => {
    const { element, settle } = await render({
      answer: async () => staffPage({ items: rows(20), total: 20 }),
    });
    await settle();

    expect(moreButton(element)).toBeUndefined();
  });

  it('draws the more button for 20 of 21', async () => {
    const { element, settle } = await render({
      answer: async () => staffPage({ items: rows(20), total: 21 }),
    });
    await settle();

    expect(moreButton(element)).toBeDefined();
  });

  it('asks for the next page once when the button is pressed twice at once', async () => {
    const { element, settle } = await render({
      answer: async ({ page }) =>
        page === 1
          ? staffPage({ items: rows(20), total: 40 })
          : staffPage({ items: rows(20, 21), page: 2, total: 40 }),
    });
    await settle();

    const button = moreButton(element);
    button?.click();
    button?.click();
    await settle();

    expect(read.mock.calls.filter(([q]) => q.page === 2)).toHaveLength(1);
  });

  it('lists a review once when the next page repeats one the first page held', async () => {
    const { element, settle } = await render({
      answer: async ({ page }) =>
        page === 1
          ? staffPage({ items: rows(20), total: 22 })
          : staffPage({ items: rows(2, 20), page: 2, total: 22 }),
    });
    await settle();
    moreButton(element)?.click();
    await settle();

    const seen = shown(element).map((r) => r.dataset['liveId']);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('draws zero-width bars, never NaN, when only reported reviews exist', async () => {
    const { element, settle } = await render({
      answer: async () =>
        staffPage({
          breakdown: { five: 0, four: 0, one: 0, three: 0, two: 0 },
          items: [staffReview({ status: 'reported' })],
          rating: null,
          reviewCount: 0,
          total: 1,
        }),
    });
    await settle();

    const widths = [...element.querySelectorAll<HTMLElement>('[data-bar]')].map(
      (bar) => bar.style.width,
    );
    expect(widths).toEqual(['0%', '0%', '0%', '0%', '0%']);
    expect(text(element.querySelector('[data-figure]'))).toContain('—');
    expect(text(element)).not.toContain('NaN');
  });

  it('draws a one-sided breakdown with one full bar and four empty', async () => {
    const { element, settle } = await render({
      answer: async () =>
        staffPage({
          breakdown: { five: 0, four: 0, one: 7, three: 0, two: 0 },
          rating: 1,
          reviewCount: 7,
          total: 7,
        }),
    });
    await settle();

    const widths = [...element.querySelectorAll<HTMLElement>('[data-bar]')].map(
      (bar) => bar.style.width,
    );
    expect(widths).toEqual(['0%', '0%', '0%', '0%', '100%']);
  });

  it('formats a count of ten thousand in the shared number format', async () => {
    const { element, settle } = await render({
      answer: async () =>
        staffPage({
          breakdown: { five: 10_000, four: 0, one: 0, three: 0, two: 0 },
          rating: 5,
          reviewCount: 10_000,
          total: 10_000,
        }),
    });
    await settle();

    expect(text(element.querySelector('[data-figure]'))).toBe(
      'Nota 5,0 din 10.000 de recenzii',
    );
  });
});

// @traces 074-FR-006
describe('live under pressure', () => {
  it('coalesces ten messages sent in one burst into at most one more read', async () => {
    const { settle } = await render({ limit: 5 });
    await settle();

    for (let i = 0; i < 10; i++) events.next(message('review.posted'));
    await wait(400);
    await settle();

    expect(read.mock.calls.length).toBeLessThanOrEqual(2);
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('never runs two reads at once when a message arrives during a read', async () => {
    let running = 0;
    let peak = 0;
    const { settle } = await render({
      answer: async () => {
        running++;
        peak = Math.max(peak, running);
        await wait(120);
        running--;
        return staffPage();
      },
      limit: 5,
    });
    await settle();

    events.next(message('review.posted'));
    await wait(60);
    events.next(message('rating.updated'));
    await wait(700);
    await settle();

    expect(peak).toBe(1);
  });

  it.each([
    ['review.replied'],
    ['review.reply_edited'],
    ['review.appeal_decided'],
  ])('reads the first page again on %s', async (kind) => {
    const { settle } = await render({ limit: 5 });
    await settle();

    events.next(message(kind));
    await wait(350);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('drops the extra pages and keeps the first when the view re-reads', async () => {
    const { element, settle } = await render({
      answer: async ({ page }) =>
        page === 1
          ? staffPage({ items: rows(20), total: 40 })
          : staffPage({ items: rows(20, 21), page: 2, total: 40 }),
    });
    await settle();
    moreButton(element)?.click();
    await settle();
    expect(shown(element)).toHaveLength(40);

    events.next(message('review.posted'));
    await wait(350);
    await settle();

    expect(shown(element)).toHaveLength(20);
    expect(read).toHaveBeenLastCalledWith({ garageId: GARAGE, page: 1 });
  });

  it('keeps showing the rows it has when a live re-read fails', async () => {
    let fail = false;
    const { element, settle } = await render({
      answer: async () => {
        if (fail) throw new HttpErrorResponse({ status: 500 });
        return staffPage();
      },
      limit: 5,
    });
    await settle();

    fail = true;
    events.next(message('review.posted'));
    await wait(350);
    await settle();

    expect(shown(element)).toHaveLength(1);
  });
});
