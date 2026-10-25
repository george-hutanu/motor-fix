import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LiveAnnouncer } from '@angular/cdk/a11y';
import { type HttpContext, HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  makeStateKey,
  PLATFORM_ID,
  signal,
  TransferState,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type GarageReviewDto,
  type GarageReviewsPageDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { ReviewsSection } from './reviews-section';
import { PUBLIC_READ } from '../../../public-read';
import { PublicLive } from '../../live';

// @traces 024-FR-001
// @traces 024-FR-002
// @traces 024-FR-003
// @traces 024-FR-004
// @traces 024-FR-005
// @traces 024-FR-007
// @traces 024-FR-008
// @traces 024-FR-010
// @traces 024-FR-011
// @traces 024-FR-012
// @traces 024-FR-013
// @traces 024-FR-014
// @traces 024-FR-015

const REVIEW: GarageReviewDto = {
  author: { shortName: 'Andrei M.' },
  car: {
    brand: 'BMW',
    engine: null,
    fuel: 'diesel',
    model: '320d',
    year: 2019,
  },
  editedAt: null,
  finalPriceBani: null,
  id: 'r-1',
  jobs: [
    {
      id: 'j-1',
      jobTypeId: 't-1',
      nameEn: 'Timing chain kit',
      nameRo: 'Kit lanț distribuție',
      position: 0,
    },
    {
      id: 'j-2',
      jobTypeId: 't-2',
      nameEn: 'Brake pads',
      nameRo: 'Plăcuțe frână',
      position: 1,
    },
  ],
  paidBani: null,
  postedAt: '2026-03-14T10:00:00.000Z',
  quote: null,
  rating: 5,
  source: 'job',
  text: 'Treabă curată, <b>la timp</b>.',
};

const review = (
  n: number,
  extra: Partial<GarageReviewDto> = {},
): GarageReviewDto => ({ ...REVIEW, id: `r-${n}`, ...extra });

const PAGE: GarageReviewsPageDto = {
  breakdown: { five: 3, four: 2, one: 1, three: 1, two: 0 },
  items: [REVIEW],
  page: 1,
  pageSize: 20,
  rating: 4.9,
  reviewCount: 212,
  total: 7,
};

const EMPTY: GarageReviewsPageDto = {
  breakdown: { five: 0, four: 0, one: 0, three: 0, two: 0 },
  items: [],
  page: 1,
  pageSize: 20,
  rating: null,
  reviewCount: 0,
  total: 0,
};

type Read = {
  params: { garageId: string; page?: number };
  context: HttpContext | undefined;
  answer: (page: GarageReviewsPageDto) => Promise<void>;
  fail: (status: number) => Promise<void>;
};
let reads: Read[];
const api = {
  reviewsControllerForGarage: jest.fn(
    (params: { garageId: string; page?: number }, context?: HttpContext) =>
      new Promise<GarageReviewsPageDto>((resolve, reject) => {
        reads.push({
          answer: async (page) => {
            resolve(page);
            await settle();
          },
          context,
          fail: async (status) => {
            reject(new HttpErrorResponse({ status }));
            await settle();
          },
          params,
        });
      }),
  ),
};

const messages = new Subject<LiveMessage>();
const resync = new Subject<void>();
const live = {
  on: (kinds: readonly EventKind[]) =>
    messages.pipe(filter((m) => kinds.includes(m.kind as EventKind))),
  register: jest.fn(() => () => undefined),
  resync,
};
const send = (kind: string) =>
  messages.next({ at: '2026-10-08T12:00:00.000Z', id: 'x', kind });

@Component({
  imports: [ReviewsSection],
  template: `<section
    data-slot="reviews"
    mf-reviews-section
    [garageId]="garageId()"
  ></section>`,
})
class Host {
  readonly garageId = signal('g-1');
}

let fixture: ComponentFixture<Host>;

function configure(platform: 'browser' | 'server' = 'browser') {
  reads = [];
  api.reviewsControllerForGarage.mockClear();
  live.register.mockClear();
  TestBed.configureTestingModule({
    providers: [
      { provide: ReviewsService, useValue: api },
      { provide: PublicLive, useValue: live },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
}

async function open() {
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(Host);
  await settle();
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  fixture?.detectChanges();
}

async function shown(page: GarageReviewsPageDto = PAGE) {
  await open();
  await reads[0]?.answer(page);
}

async function english() {
  await TestBed.inject(I18n).use('en');
  await settle();
}

async function liveMessage(kind: string) {
  send(kind);
  jest.advanceTimersByTime(300);
  await settle();
}

const section = () =>
  fixture.nativeElement.querySelector('section') as HTMLElement;
const text = () => section().textContent?.replace(/\s+/g, ' ').trim() ?? '';
const reviews = () => [
  ...section().querySelectorAll<HTMLElement>('article.review'),
];
const rows = () => [
  ...section().querySelectorAll<HTMLElement>('.breakdown li'),
];
const rowText = (row: HTMLElement) =>
  [...row.children]
    .map((part) => part.textContent?.trim())
    .filter(Boolean)
    .join(' ');
const button = (label: string) =>
  [...section().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(label),
  );

afterEach(() => {
  fixture?.destroy();
  jest.useRealTimers();
});

describe('the reviews section on a garage profile', () => {
  beforeEach(() => configure());

  it('reads the first page of the garage’s reviews as a public read, joining no stream of its own', async () => {
    await open();

    expect(api.reviewsControllerForGarage).toHaveBeenCalledTimes(1);
    expect(reads[0]?.params).toEqual({ garageId: 'g-1', page: 1 });
    expect(reads[0]?.context?.get(PUBLIC_READ)).toBe(true);
    expect(live.register).not.toHaveBeenCalled();
  });

  it('heads itself “Ce spun șoferii” and names the section by it', async () => {
    await shown();

    const heading = section().querySelector('h2');
    expect(heading?.textContent?.trim()).toBe('Ce spun șoferii');
    expect(section().getAttribute('aria-label')).toBe('Ce spun șoferii');
  });

  it('shows the stored rating with a comma, the stored count and the five rows from five stars to one', async () => {
    await shown();

    expect(section().querySelector('.figure')?.textContent?.trim()).toBe('4,9');
    expect(text()).toContain('212 recenzii');
    expect(rows().map(rowText)).toEqual([
      '5 stele 3',
      '4 stele 2',
      '3 stele 1',
      '2 stele 0',
      '1 stea 1',
    ]);
  });

  it('writes the count in the singular for one review', async () => {
    await shown({
      ...PAGE,
      breakdown: { five: 1, four: 0, one: 0, three: 0, two: 0 },
      rating: 5,
      reviewCount: 1,
      total: 1,
    });

    expect(text()).toContain('1 recenzie');
    expect(text()).not.toContain('1 recenzii');
  });

  it('shows each row’s share as a bar beside its number, never by colour alone', async () => {
    await shown();

    const [five] = rows();
    const bar = five?.querySelector<HTMLElement>('.bar span');
    expect(bar?.style.width).toBe(`${(3 / 7) * 100}%`);
    expect(five?.querySelector('.bar')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(rowText(five as HTMLElement)).toContain('3');
  });

  it('shows “—”, “Încă nu are recenzii.”, no rows and no list for a garage nobody reviewed', async () => {
    await shown(EMPTY);

    expect(section().querySelector('.figure')?.textContent?.trim()).toBe('—');
    expect(text()).toContain('Încă nu are recenzii.');
    expect(rows()).toHaveLength(0);
    expect(reviews()).toHaveLength(0);
    expect(button('Vezi mai multe')).toBeUndefined();
  });

  it('keeps a bar visible for a score one review in hundreds gave, and none for a score nobody gave', async () => {
    await shown({
      ...PAGE,
      breakdown: { five: 499, four: 0, one: 1, three: 0, two: 0 },
      total: 500,
    });

    const bars = rows().map(
      (row) => row.querySelector<HTMLElement>('.bar span')?.style.minWidth,
    );
    expect(bars).toEqual(['4px', '0px', '0px', '0px', '4px']);
  });

  it('shows the dash for a null stored rating while reviews are listed', async () => {
    await shown({ ...PAGE, rating: null });

    expect(section().querySelector('.figure')?.textContent?.trim()).toBe('—');
    expect(reviews()).toHaveLength(1);
  });

  it('shows a review’s car and included jobs, its score, its text, its author and its month', async () => {
    await shown();

    const [one] = reviews();
    expect(one?.querySelector('.about')?.textContent?.trim()).toBe(
      'BMW 320d · Kit lanț distribuție, Plăcuțe frână',
    );
    expect(one?.querySelector('.score')?.textContent?.trim()).toBe('5,0 / 5');
    expect(one?.querySelector('.author')?.textContent?.trim()).toBe(
      'Andrei M.',
    );
    expect(one?.querySelector('.month')?.textContent?.trim()).toBe(
      'mart. 2026',
    );
  });

  it('shows the text as plain text, never as markup', async () => {
    await shown();

    const body = reviews()[0]?.querySelector('.text');
    expect(body?.textContent).toBe('Treabă curată, <b>la timp</b>.');
    expect(body?.querySelector('b')).toBeNull();
  });

  it('leaves out the text block of a rating without text', async () => {
    await shown({ ...PAGE, items: [review(1, { text: null })] });

    expect(reviews()[0]?.querySelector('.text')).toBeNull();
  });

  it('dates a review posted late on the last day of a month in Bucharest by the next month', async () => {
    await shown({
      ...PAGE,
      items: [review(1, { postedAt: '2026-02-28T23:30:00.000Z' })],
    });

    expect(reviews()[0]?.querySelector('.month')?.textContent?.trim()).toBe(
      'mart. 2026',
    );
  });

  it('signs a deleted author’s review “Șofer MotorFix”, and “MotorFix driver” in English', async () => {
    await shown({
      ...PAGE,
      items: [review(1, { author: { shortName: 'Șofer MotorFix' } })],
    });

    expect(reviews()[0]?.querySelector('.author')?.textContent?.trim()).toBe(
      'Șofer MotorFix',
    );

    await english();

    expect(reviews()[0]?.querySelector('.author')?.textContent?.trim()).toBe(
      'MotorFix driver',
    );
  });

  it('says it all in English: heading, rating, count, rows, jobs, score and month', async () => {
    await shown();
    await english();

    expect(section().querySelector('h2')?.textContent?.trim()).toBe(
      'What drivers say',
    );
    expect(section().querySelector('.figure')?.textContent?.trim()).toBe('4.9');
    expect(text()).toContain('212 reviews');
    expect(rows().map(rowText)).toEqual([
      '5 stars 3',
      '4 stars 2',
      '3 stars 1',
      '2 stars 0',
      '1 star 1',
    ]);
    const [one] = reviews();
    expect(one?.querySelector('.about')?.textContent?.trim()).toBe(
      'BMW 320d · Timing chain kit, Brake pads',
    );
    expect(one?.querySelector('.score')?.textContent?.trim()).toBe('5.0 / 5');
    expect(one?.querySelector('.month')?.textContent?.trim()).toBe('Mar 2026');
  });

  it('says the empty state in English', async () => {
    await shown(EMPTY);
    await english();

    expect(text()).toContain('No reviews yet.');
  });

  it('offers no button to write a review', async () => {
    await shown();

    expect(text()).not.toContain('Scrie o recenzie');
    await english();
    expect(text()).not.toContain('Write a review');
  });
});

describe('the pages of the reviews section', () => {
  beforeEach(() => configure());

  const first = {
    ...PAGE,
    items: Array.from({ length: 20 }, (_, i) => review(i + 1)),
    total: 21,
  };

  it('offers “Vezi mai multe” while more pages remain, and appends the next page below', async () => {
    await shown(first);

    button('Vezi mai multe')?.click();
    await settle();

    expect(reads[1]?.params).toEqual({ garageId: 'g-1', page: 2 });
    expect(button('Vezi mai multe')?.disabled).toBe(true);

    await reads[1]?.answer({ ...first, items: [review(21)], page: 2 });

    expect(reviews().map((r) => r.dataset['liveId'])).toEqual(
      Array.from({ length: 21 }, (_, i) => `r-${i + 1}`),
    );
    expect(button('Vezi mai multe')).toBeUndefined();
  });

  it('shows 20, then 40, then all 45 reviews, the button gone after two presses', async () => {
    const page = (n: number, from: number, size: number) => ({
      ...PAGE,
      items: Array.from({ length: size }, (_, i) => review(from + i)),
      page: n,
      total: 45,
    });
    await shown(page(1, 1, 20));

    button('Vezi mai multe')?.click();
    await settle();
    await reads[1]?.answer(page(2, 21, 20));
    expect(reviews()).toHaveLength(40);

    button('Vezi mai multe')?.click();
    await settle();
    expect(reads[2]?.params).toEqual({ garageId: 'g-1', page: 3 });
    await reads[2]?.answer(page(3, 41, 5));

    expect(reviews()).toHaveLength(45);
    expect(button('Vezi mai multe')).toBeUndefined();
  });

  it('offers no button when the first page is the last', async () => {
    await shown({
      ...PAGE,
      breakdown: { five: 1, four: 0, one: 0, three: 0, two: 0 },
      total: 1,
    });

    expect(button('Vezi mai multe')).toBeUndefined();
  });

  it('says “See more” in English', async () => {
    await shown(first);
    await english();

    expect(button('See more')).toBeDefined();
  });

  it('keeps the loaded pages when the next one fails, with the error line and a retry in the button’s place', async () => {
    await shown(first);
    button('Vezi mai multe')?.click();
    await settle();

    await reads[1]?.fail(503);

    expect(reviews()).toHaveLength(20);
    expect(text()).toContain('Nu am putut încărca recenziile');
    expect(button('Vezi mai multe')).toBeUndefined();

    button('Încearcă din nou')?.click();
    await settle();
    expect(reads[2]?.params).toEqual({ garageId: 'g-1', page: 2 });
    await reads[2]?.answer({ ...first, items: [review(21)], page: 2 });

    expect(reviews()).toHaveLength(21);
    expect(text()).not.toContain('Nu am putut încărca recenziile');
  });
});

describe('the reviews section moved to another garage', () => {
  beforeEach(() => configure());

  it('reads the new garage’s first page, dropping the old pages and the old page still loading', async () => {
    await shown({
      ...PAGE,
      items: Array.from({ length: 20 }, (_, i) => review(i + 1)),
      total: 21,
    });
    button('Vezi mai multe')?.click();
    await settle();

    fixture.componentInstance.garageId.set('g-2');
    await settle();
    expect(reads[2]?.params).toEqual({ garageId: 'g-2', page: 1 });

    await reads[2]?.answer({
      ...PAGE,
      items: [review(90, { text: 'Alt service.' })],
      total: 1,
    });
    await reads[1]?.answer({
      ...PAGE,
      items: [review(21)],
      page: 2,
      total: 21,
    });

    expect(reviews().map((r) => r.dataset['liveId'])).toEqual(['r-90']);
    expect(button('Vezi mai multe')).toBeUndefined();
  });
});

describe('the reviews section kept live', () => {
  beforeEach(() => {
    configure();
    jest.useFakeTimers();
  });

  it.each([
    ['review.posted'],
    ['review.edited'],
    ['review.reported'],
    ['review.decided'],
    ['review.deleted'],
    ['rating.updated'],
  ])('reads the first page again on %s', async (kind) => {
    await shown();

    await liveMessage(kind);
    await reads[1]?.answer({
      ...PAGE,
      items: [review(2, { text: 'Nou.' }), REVIEW],
      rating: 4.8,
      reviewCount: 213,
      total: 8,
    });

    expect(reads[1]?.params).toEqual({ garageId: 'g-1', page: 1 });
    expect(reviews()).toHaveLength(2);
    expect(section().querySelector('.figure')?.textContent?.trim()).toBe('4,8');
  });

  it('reads the first page once for a burst of messages', async () => {
    await shown();

    send('review.posted');
    send('rating.updated');
    send('review.edited');
    jest.advanceTimersByTime(300);
    await settle();

    expect(reads).toHaveLength(2);
  });

  it('reads nothing on a message of another kind', async () => {
    await shown();

    await liveMessage('price_list.updated');

    expect(reads).toHaveLength(1);
  });

  it('reads the first page again when the stream reopens', async () => {
    await shown();

    resync.next();
    await settle();

    expect(reads[1]?.params).toEqual({ garageId: 'g-1', page: 1 });
  });

  it('drops the extra pages on a re-read, keeping the rows it already drew', async () => {
    const first = {
      ...PAGE,
      items: Array.from({ length: 20 }, (_, i) => review(i + 1)),
      total: 21,
    };
    await shown(first);
    button('Vezi mai multe')?.click();
    await settle();
    await reads[1]?.answer({ ...first, items: [review(21)], page: 2 });
    const kept = reviews()[0];

    await liveMessage('review.posted');
    await reads[2]?.answer(first);

    expect(reviews()).toHaveLength(20);
    expect(reviews()[0]).toBe(kept);
    expect(button('Vezi mai multe')).toBeDefined();
  });

  it('lets a re-read that starts while a page loads win over that page', async () => {
    const first = {
      ...PAGE,
      items: Array.from({ length: 20 }, (_, i) => review(i + 1)),
      total: 21,
    };
    await shown(first);
    button('Vezi mai multe')?.click();
    await settle();

    await liveMessage('review.posted');
    await reads[2]?.answer({ ...first, total: 22 });
    await reads[1]?.answer({ ...first, items: [review(21)], page: 2 });

    expect(reviews()).toHaveLength(20);
    expect(button('Vezi mai multe')?.disabled).toBe(false);
  });

  it('drops a page asked for while a re-read was already on its way', async () => {
    const first = {
      ...PAGE,
      items: Array.from({ length: 20 }, (_, i) => review(i + 1)),
      total: 45,
    };
    await shown(first);
    button('Vezi mai multe')?.click();
    await settle();
    await reads[1]?.answer({
      ...first,
      items: Array.from({ length: 20 }, (_, i) => review(i + 21)),
      page: 2,
    });

    await liveMessage('review.posted');
    button('Vezi mai multe')?.click();
    await settle();
    await reads[2]?.answer(first);
    await reads[3]?.answer({
      ...first,
      items: Array.from({ length: 5 }, (_, i) => review(i + 41)),
      page: 3,
    });

    expect(reviews()).toHaveLength(20);
    expect(button('Vezi mai multe')?.disabled).toBe(false);
  });

  it('keeps what it shows when a re-read fails', async () => {
    await shown();

    await liveMessage('review.posted');
    await reads[1]?.fail(503);

    expect(reviews()).toHaveLength(1);
    expect(text()).not.toContain('Nu am putut încărca recenziile');
  });

  it('swaps a re-read in silently: the header’s dial is what announces the rating', async () => {
    const announce = jest
      .spyOn(TestBed.inject(LiveAnnouncer), 'announce')
      .mockResolvedValue();
    await shown();

    await liveMessage('rating.updated');
    await reads[1]?.answer({ ...PAGE, rating: 4.8 });

    expect(announce).not.toHaveBeenCalled();
  });
});

describe('the reviews section before and without an answer', () => {
  beforeEach(() => configure());

  it('shows a skeleton hidden from assistive technology until the first answer', async () => {
    await open();

    const skeleton = section().querySelector('.loading');
    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');

    await reads[0]?.answer(PAGE);

    expect(section().querySelector('.loading')).toBeNull();
  });

  it('shows the error line and a retry when the first read fails, and reads again on retry', async () => {
    await open();
    await reads[0]?.fail(503);

    expect(text()).toContain('Nu am putut încărca recenziile');
    expect(section().querySelector('.loading')).toBeNull();

    button('Încearcă din nou')?.click();
    await settle();
    await reads[1]?.answer(PAGE);

    expect(reviews()).toHaveLength(1);
    expect(text()).not.toContain('Nu am putut încărca recenziile');
  });

  it('says the failure in English', async () => {
    await open();
    await reads[0]?.fail(503);
    await english();

    expect(text()).toContain('We could not load the reviews');
    expect(button('Try again')).toBeDefined();
  });
});

describe('the reviews section in the server render', () => {
  beforeEach(() => configure('server'));

  it('hands the first page to the browser, which shows it without a skeleton or a second read', async () => {
    await shown();
    const handed = TestBed.inject(TransferState).get(
      makeStateKey<GarageReviewsPageDto>('reviews:g-1'),
      undefined,
    );
    fixture.destroy();
    TestBed.resetTestingModule();
    configure('browser');
    TestBed.inject(TransferState).set(
      makeStateKey<GarageReviewsPageDto>('reviews:g-1'),
      handed as GarageReviewsPageDto,
    );

    await open();

    expect(handed).toEqual(PAGE);
    expect(reads).toHaveLength(0);
    expect(section().querySelector('.loading')).toBeNull();
    expect(reviews()).toHaveLength(1);
  });
});

// @traces 1367-FR-001
// @traces 1367-FR-002
// @traces 1367-FR-003
// @traces 1367-FR-005
// @traces 1367-FR-007
// @traces 1367-FR-009
// @traces 1367-FR-012
describe('the prices and the marks under a review', () => {
  beforeEach(() => configure());

  const price = () => reviews()[0]?.querySelector('.price');
  const priceText = () => price()?.textContent?.replace(/\s+/g, ' ').trim();
  // The line's parts sit apart by the flex gap, not by spaces.
  const byText = () =>
    [...(reviews()[0]?.querySelector('.by')?.children ?? [])]
      .map((part) => part.textContent?.replace(/\s+/g, ' ').trim())
      .join(' ');
  const priced = (extra: Partial<GarageReviewDto>) =>
    shown({ ...PAGE, items: [review(1, extra)] });
  const FULL = {
    finalPriceBani: 420_000,
    paidBani: 450_000,
    quote: { fromBani: 380_000, toBani: 440_000 },
  };

  it.each([
    [
      'the quote, the final price and the driver’s other amount',
      FULL,
      'Ofertă 3.800 – 4.400 lei · Final 4.200 lei · Plătit, după șofer: 4.500 lei',
      'Quote 3,800 – 4,400 lei · Final 4,200 lei · Paid, says the driver: 4,500 lei',
    ],
    [
      'the amount once when the driver gave the final price',
      { ...FULL, paidBani: 420_000 },
      'Ofertă 3.800 – 4.400 lei · Final 4.200 lei',
      'Quote 3,800 – 4,400 lei · Final 4,200 lei',
    ],
    [
      'one amount for a quote whose ends are equal',
      {
        finalPriceBani: null,
        paidBani: null,
        quote: { fromBani: 420_000, toBani: 420_000 },
      },
      'Ofertă 4.200 lei',
      'Quote 4,200 lei',
    ],
    [
      'the driver’s amount when the job has no final price',
      { ...FULL, finalPriceBani: null, paidBani: 400_000 },
      'Ofertă 3.800 – 4.400 lei · Plătit, după șofer: 4.000 lei',
      'Quote 3,800 – 4,400 lei · Paid, says the driver: 4,000 lei',
    ],
    [
      'each amount in its own decimals',
      { ...FULL, paidBani: 450_050 },
      'Ofertă 3.800 – 4.400 lei · Final 4.200 lei · Plătit, după șofer: 4.500,50 lei',
      'Quote 3,800 – 4,400 lei · Final 4,200 lei · Paid, says the driver: 4,500.50 lei',
    ],
  ])('writes %s', async (_case, extra, ro, en) => {
    await priced(extra);

    expect(priceText()).toBe(ro);

    await english();

    expect(priceText()).toBe(en);
  });

  it('draws the price line between the text and the author line', async () => {
    await priced(FULL);

    const parts = [...(reviews()[0]?.children ?? [])].map((el) => el.className);
    expect(parts).toEqual(['top', 'text', 'price', 'by']);
  });

  it('draws no price line when the read carries no amount', async () => {
    await priced({ finalPriceBani: null, paidBani: null, quote: null });

    expect(price()).toBeNull();
    expect(reviews()[0]?.querySelectorAll('p')).toHaveLength(2);
  });

  it('marks an edited review “Editată · 5 oct. 2026” after the month, “Edited · 5 Oct 2026” in English', async () => {
    await priced({ editedAt: '2026-10-05T09:30:00.000Z' });

    expect(byText()).toBe('Andrei M. · mart. 2026 · Editată · 5 oct. 2026');
    expect(
      reviews()[0]
        ?.querySelector('.edited')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    ).toBe('Editată · 5 oct. 2026');

    await english();

    expect(byText()).toBe('Andrei M. · Mar 2026 · Edited · 5 Oct 2026');
  });

  it('dates the edit by its Bucharest day', async () => {
    await priced({ editedAt: '2026-10-04T22:30:00.000Z' });

    expect(byText()).toContain('Editată · 5 oct. 2026');
  });

  it('leaves the mark out of a review never edited', async () => {
    await priced({ editedAt: null });

    expect(reviews()[0]?.querySelector('.edited')).toBeNull();
    expect(byText()).toBe('Andrei M. · mart. 2026');
  });

  it('shows “Nu prin MotorFix” in the car-and-job place of a review written from the profile, with no price line', async () => {
    await priced({
      car: null,
      editedAt: '2026-10-05T09:30:00.000Z',
      jobs: [],
      source: 'profile',
    });

    const [one] = reviews();
    expect(one?.querySelector('.about')?.textContent?.trim()).toBe(
      'Nu prin MotorFix',
    );
    expect(price()).toBeNull();
    expect(one?.querySelector('.score')?.textContent?.trim()).toBe('5,0 / 5');
    expect(byText()).toBe('Andrei M. · mart. 2026 · Editată · 5 oct. 2026');

    await english();

    expect(reviews()[0]?.querySelector('.about')?.textContent?.trim()).toBe(
      'Not through MotorFix',
    );
  });

  it('shows no price line for a profile review even if amounts reached it', async () => {
    await priced({ ...FULL, car: null, jobs: [], source: 'profile' });

    expect(price()).toBeNull();
  });
});

describe('the reviews section’s styles', () => {
  const css = readFileSync(join(__dirname, 'reviews-section.css'), 'utf8');

  it('gives its buttons a 44 px touch target under 640 px', () => {
    expect(css).toMatch(/min-height:\s*44px/);
  });

  it('wraps a long text at any width', () => {
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('draws its small text at the body size on a phone', () => {
    expect(css).toMatch(
      /@media \(max-width: 767\.98px\)\s*{\s*:host\s*{\s*--mf-size-small:\s*var\(--mf-size-body\);/,
    );
  });

  it('keeps the author, the dot and the month a word apart', () => {
    expect(css).toMatch(/\.by\s*{[^}]*gap:\s*var\(--mf-space-1\);/);
  });

  it('draws the price line muted, at the author line’s size, wrapping at any width', () => {
    expect(css).toMatch(/\.price\s*{[^}]*color:\s*var\(--mf-text-secondary\)/);
  });

  it('caps the breakdown rows at the board’s 420 px', () => {
    expect(css).toMatch(/\.breakdown\s*{[^}]*max-width:\s*420px;/);
  });
});
