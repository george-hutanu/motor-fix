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
import { openReportReview } from '../../report-review-dialog/open-report-review';
import { Session } from '../../session';
import { staffPage, staffReview } from '../garage-reviews.testing';

jest.mock('../../report-review-dialog/open-report-review', () => ({
  openReportReview: jest.fn(),
}));
const opened = openReportReview as jest.Mock;

const GARAGE = 'garage-1';
const SLUG = 'service-auto-militari';

const me = (role: 'owner' | 'receptionist' = 'owner') =>
  ({
    capabilities: ['garage.reviews'],
    garageAccess: [
      { features: {}, garageId: GARAGE, role, status: 'approved' },
    ],
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
let resync: Subject<void>;
let read: jest.Mock;

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => staffReview({ id: `r-${i + 1}` }));

async function render({
  answer = async () => staffPage({ slug: SLUG }),
  language = 'ro',
  limit,
  role = 'owner',
}: {
  answer?: (query: {
    garageId: string;
    page: number;
  }) => Promise<GarageStaffReviewsPageDto>;
  language?: 'ro' | 'en';
  limit?: number;
  role?: 'owner' | 'receptionist';
} = {}) {
  events = new Subject();
  resync = new Subject();
  read = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: ReviewsService,
        useValue: { garageReviewsControllerRead: read },
      },
      { provide: Session, useValue: { shown: signal(me(role)) } },
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
  if (language === 'en') await TestBed.inject(I18n).use('en');
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
const link = (element: HTMLElement, name: string) =>
  element.querySelector<HTMLAnchorElement>(`a[data-${name}]`);
const button = (element: HTMLElement, label: string) =>
  [...element.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === label,
  );
const message = (kind: string): LiveMessage => ({
  at: '2026-10-25T12:00:00.000Z',
  id: 'r-9',
  kind,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => TestBed.resetTestingModule());

// @traces 074-FR-001 074-FR-007
describe('Recenzii noi on the garage home', () => {
  it('reads the first page of the session garage once and shows its five newest', async () => {
    const { element, settle } = await render({
      answer: async () => staffPage({ items: rows(7), slug: SLUG }),
      limit: 5,
    });
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ garageId: GARAGE, page: 1 });
    expect(text(element.querySelector('h2'))).toBe('Recenzii noi');
    expect(shown(element).map((row) => row.dataset['liveId'])).toEqual([
      'r-1',
      'r-2',
      'r-3',
      'r-4',
      'r-5',
    ]);
  });

  it('links to the public profile and to every review, with no breakdown or more', async () => {
    const { element, settle } = await render({ limit: 5 });
    await settle();

    expect(text(link(element, 'profile'))).toBe('Vezi profilul public');
    expect(link(element, 'profile')?.getAttribute('href')).toBe(
      `/ro/garages/${SLUG}`,
    );
    expect(text(link(element, 'all'))).toBe('Vezi toate');
    expect(link(element, 'all')?.getAttribute('href')).toBe(
      '/app/garage/reviews',
    );
    expect(element.querySelector('[data-breakdown]')).toBeNull();
    expect(element.querySelector('[data-figure]')).toBeNull();
    expect(button(element, 'Vezi mai multe')).toBeUndefined();
  });

  it('says there are no reviews yet, with no "see all" but still the profile link', async () => {
    const { element, settle } = await render({
      answer: async () =>
        staffPage({
          breakdown: { five: 0, four: 0, one: 0, three: 0, two: 0 },
          items: [],
          rating: null,
          reviewCount: 0,
          slug: SLUG,
          total: 0,
        }),
      limit: 5,
    });
    await settle();

    expect(text(element.querySelector('[data-empty]'))).toBe(
      'Încă nu ai recenzii. Apar aici după prima lucrare predată.',
    );
    expect(link(element, 'all')).toBeNull();
    expect(link(element, 'profile')).not.toBeNull();
  });

  // @traces 099-FR-003
  // @traces 099-FR-014
  it('makes its title the one link to Recenzii, and keeps the view title plain', async () => {
    const home = await render({ limit: 5 });
    await home.settle();

    expect(home.element.querySelectorAll('h2')).toHaveLength(1);
    expect(home.element.querySelector('h2 > a')?.getAttribute('href')).toBe(
      '/app/garage/reviews',
    );
    expect(text(home.element.querySelector('h2 > a'))).toBe('Recenzii noi');
    TestBed.resetTestingModule();

    const view = await render();
    await view.settle();

    expect(view.element.querySelector('h2 > a')).toBeNull();
  });

  it('writes its texts in English', async () => {
    const { element, settle } = await render({ language: 'en', limit: 5 });
    await settle();

    expect(text(element.querySelector('h2'))).toBe('New reviews');
    expect(text(link(element, 'profile'))).toBe('See the public profile');
    expect(link(element, 'profile')?.getAttribute('href')).toBe(
      `/en/garages/${SLUG}`,
    );
    expect(text(link(element, 'all'))).toBe('See all');
  });
});

// @traces 074-FR-002
describe('the Recenzii view', () => {
  it('shows the rating, the count and five bars relative to the largest', async () => {
    const { element, settle } = await render();
    await settle();

    expect(text(element.querySelector('[data-figure]'))).toBe(
      'Nota 4,9 din 212 recenzii',
    );
    expect(text(element.querySelector('[data-breakdown-title]'))).toBe(
      'Distribuția notelor',
    );
    const bars = [
      ...element.querySelectorAll<HTMLElement>('[data-breakdown] li'),
    ];
    expect(bars.map((bar) => text(bar.querySelector('[data-label]')))).toEqual([
      '5 / 5',
      '4 / 5',
      '3 / 5',
      '2 / 5',
      '1 / 5',
    ]);
    expect(bars.map((bar) => text(bar.querySelector('[data-count]')))).toEqual([
      '180',
      '22',
      '6',
      '2',
      '2',
    ]);
    const widths = bars.map(
      (bar) => bar.querySelector<HTMLElement>('[data-bar]')?.style.width,
    );
    expect(widths[0]).toBe('100%');
    expect(Number.parseFloat(widths[1] ?? '')).toBeCloseTo((22 / 180) * 100, 1);
    expect(link(element, 'all')).toBeNull();
  });

  it('writes the figure in English, singular for one review', async () => {
    const { element, settle } = await render({
      answer: async () =>
        staffPage({
          breakdown: { five: 1, four: 0, one: 0, three: 0, two: 0 },
          rating: 5,
          reviewCount: 1,
          slug: SLUG,
          total: 1,
        }),
      language: 'en',
    });
    await settle();

    expect(text(element.querySelector('[data-figure]'))).toBe(
      'Rating 5.0 from 1 review',
    );
  });

  it('adds the next page under the rows and hides "see more" after the last', async () => {
    const { element, settle } = await render({
      answer: async ({ page }) =>
        page === 1
          ? staffPage({ items: rows(20), slug: SLUG, total: 21 })
          : staffPage({
              items: [staffReview({ id: 'r-21' })],
              page: 2,
              slug: SLUG,
              total: 21,
            }),
    });
    await settle();
    expect(shown(element)).toHaveLength(20);

    button(element, 'Vezi mai multe')?.click();
    await settle();

    expect(read).toHaveBeenLastCalledWith({ garageId: GARAGE, page: 2 });
    expect(shown(element).at(-1)?.dataset['liveId']).toBe('r-21');
    expect(button(element, 'Vezi mai multe')).toBeUndefined();
  });

  it('drops a next page that answers after a live message read the first page again', async () => {
    let answerPage2: (page: GarageStaffReviewsPageDto) => void = () =>
      undefined;
    const { element, settle } = await render({
      answer: ({ page }) =>
        page === 1
          ? Promise.resolve(
              staffPage({ items: rows(20), slug: SLUG, total: 41 }),
            )
          : new Promise((resolve) => {
              answerPage2 = resolve;
            }),
    });
    await settle();
    button(element, 'Vezi mai multe')?.click();
    await settle();

    events.next(message('review.posted'));
    await wait(350);
    await settle();
    answerPage2(
      staffPage({
        items: [staffReview({ id: 'r-stale' })],
        page: 2,
        slug: SLUG,
        total: 41,
      }),
    );
    await settle();

    expect(shown(element)).toHaveLength(20);
    expect(element.querySelector('[data-live-id="r-stale"]')).toBeNull();
    expect(button(element, 'Vezi mai multe')?.disabled).toBe(false);
  });

  it('says a further page failed and tries it again', async () => {
    let fail = true;
    const { element, settle } = await render({
      answer: async ({ page }) => {
        if (page === 1)
          return staffPage({ items: rows(20), slug: SLUG, total: 21 });
        if (fail) throw new HttpErrorResponse({ status: 500 });
        return staffPage({
          items: [staffReview({ id: 'r-21' })],
          page: 2,
          slug: SLUG,
          total: 21,
        });
      },
    });
    await settle();
    button(element, 'Vezi mai multe')?.click();
    await settle();

    expect(text(element.querySelector('[role="alert"]'))).toContain(
      'Nu am putut încărca mai multe recenzii.',
    );
    fail = false;
    button(element, 'Încearcă din nou')?.click();
    await settle();
    expect(shown(element)).toHaveLength(21);
  });
});

// @traces 074-FR-015
describe('loading and failing', () => {
  it('draws placeholders while the first page loads', async () => {
    const { element, settle } = await render({
      answer: () => new Promise(() => undefined),
    });
    await settle();

    expect(element.querySelector('[data-loading]')).not.toBeNull();
    expect(shown(element)).toHaveLength(0);
  });

  it('says the reviews could not load and reads them again on retry', async () => {
    let fail = true;
    const { element, settle } = await render({
      answer: async () => {
        if (fail) throw new HttpErrorResponse({ status: 500 });
        return staffPage({ slug: SLUG });
      },
    });
    await settle();

    expect(text(element.querySelector('[role="alert"]'))).toContain(
      'Nu am putut încărca recenziile.',
    );
    fail = false;
    button(element, 'Încearcă din nou')?.click();
    await settle();
    expect(shown(element)).toHaveLength(1);
  });
});

// @traces 074-FR-006
describe('live', () => {
  it.each([
    ['review.posted'],
    ['review.edited'],
    ['review.reported'],
    ['review.decided'],
    ['review.deleted'],
    ['rating.updated'],
  ])('reads the first page again on %s', async (kind) => {
    const { settle } = await render({ limit: 5 });
    await settle();
    expect(read).toHaveBeenCalledTimes(1);

    events.next(message(kind));
    await wait(350);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('shows a review posted while the panel is open at the top', async () => {
    let items = [staffReview({ id: 'r-1' })];
    const { element, settle } = await render({
      answer: async () => staffPage({ items, slug: SLUG }),
      limit: 5,
    });
    await settle();

    items = [staffReview({ id: 'r-new' }), ...items];
    events.next(message('review.posted'));
    await wait(350);
    await settle();

    expect(shown(element)[0]?.dataset['liveId']).toBe('r-new');
  });

  it('reads again on a resync, and ignores a kind that is not about reviews', async () => {
    const { settle } = await render({ limit: 5 });
    await settle();

    events.next(message('request.created'));
    await wait(350);
    await settle();
    expect(read).toHaveBeenCalledTimes(1);

    resync.next();
    await wait(350);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

// @traces 074-FR-007 1382-FR-001
describe('what a row offers by role', () => {
  it('offers the owner Raportează and no reply', async () => {
    const { element, settle } = await render({ role: 'owner' });
    await settle();

    const labels = [...element.querySelectorAll('button')].map(text);
    expect(labels.filter((label) => label !== 'Vezi mai multe')).toEqual([
      'Raportează',
    ]);
  });

  it('offers the receptionist no reply or report button', async () => {
    const { element, settle } = await render({
      answer: async () =>
        staffPage({
          items: [staffReview({ canReply: false, canReport: false })],
          slug: SLUG,
        }),
      role: 'receptionist',
    });
    await settle();

    expect(text(element)).not.toMatch(/Răspunde|Raportează/);
    const labels = [...element.querySelectorAll('button')].map(text);
    expect(labels.every((label) => label === 'Vezi mai multe')).toBe(true);
  });
});

// @traces 1382-FR-005
describe('reporting a review from the panel', () => {
  const reportButton = (element: HTMLElement) =>
    element.querySelector<HTMLButtonElement>('button[data-report-button]');
  const ANSWER = {
    dueAt: '2026-10-27T12:00:00.000Z',
    id: 'rep-1',
    reason: 'insults',
    review: { id: 'r-1', status: 'reported' },
    status: 'pending',
  };

  afterEach(() => opened.mockReset());

  it('opens the task for the row and shows it reported at once, without a re-read', async () => {
    opened.mockResolvedValue(ANSWER);
    const { element, settle } = await render();
    await settle();

    reportButton(element)?.click();
    await settle();

    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0][1]).toMatchObject({ id: 'r-1' });
    expect(read).toHaveBeenCalledTimes(1);
    const [row] = shown(element);
    expect(row.querySelector('[data-reported]')).not.toBeNull();
    expect(reportButton(element)).toBeNull();
  });

  it('holds the reported row only until the next first-page read', async () => {
    opened.mockResolvedValue(ANSWER);
    const { element, settle } = await render();
    await settle();
    reportButton(element)?.click();
    await settle();

    events.next(message('review.reported'));
    await wait(350);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(shown(element)[0].querySelector('[data-reported]')).toBeNull();
    expect(reportButton(element)).not.toBeNull();
  });

  it('reads the first page again when the task closes on a refusal', async () => {
    opened.mockResolvedValue('refused');
    const { element, settle } = await render();
    await settle();

    reportButton(element)?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('changes nothing when the task is cancelled', async () => {
    opened.mockResolvedValue('cancelled');
    const { element, settle } = await render();
    await settle();

    reportButton(element)?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(reportButton(element)).not.toBeNull();
  });

  it('opens one task at a time, and again after a chunk that failed to load', async () => {
    let close: (value: unknown) => void = () => undefined;
    opened.mockReturnValueOnce(
      new Promise((resolve) => {
        close = resolve;
      }),
    );
    const { element, settle } = await render();
    await settle();

    reportButton(element)?.click();
    reportButton(element)?.click();
    await settle();
    expect(opened).toHaveBeenCalledTimes(1);
    close('cancelled');
    await settle();

    opened.mockRejectedValueOnce(new Error('ChunkLoadError'));
    reportButton(element)?.click();
    await settle();
    opened.mockResolvedValueOnce('cancelled');
    reportButton(element)?.click();
    await settle();

    expect(opened).toHaveBeenCalledTimes(3);
  });
});
