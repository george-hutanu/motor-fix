import { type HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Component, PLATFORM_ID, signal } from '@angular/core';
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
import { PublicLive } from '../../live';

// @traces 024-FR-002
// @traces 024-FR-003
// @traces 024-FR-004
// @traces 024-FR-005
// @traces 024-FR-007
// @traces 024-FR-010
// @traces 024-FR-011
// @traces 024-FR-012

const REVIEW = {
  author: { shortName: 'Andrei M.' },
  car: { brand: 'BMW', model: '320d' },
  id: 'r-1',
  jobs: [{ id: 'j-1', nameEn: 'Brake pads', nameRo: 'Plăcuțe frână' }],
  postedAt: '2026-03-14T10:00:00.000Z',
  rating: 5,
  source: 'job',
  text: 'Ok',
} as GarageReviewDto;

const review = (n: number, extra: Partial<GarageReviewDto> = {}) =>
  ({ ...REVIEW, id: `r-${n}`, ...extra }) as GarageReviewDto;

const PAGE = {
  breakdown: { five: 1, four: 0, one: 0, three: 0, two: 0 },
  items: [REVIEW],
  page: 1,
  pageSize: 20,
  rating: 5,
  reviewCount: 1,
  total: 1,
};

type Read = {
  params: { garageId: string; page?: number };
  answer: (page: GarageReviewsPageDto) => Promise<void>;
  fail: (status: number) => Promise<void>;
};
let reads: Read[];
const api = {
  reviewsControllerForGarage: jest.fn(
    (params: { garageId: string; page?: number }, _c?: HttpContext) =>
      new Promise<GarageReviewsPageDto>((resolve, reject) => {
        reads.push({
          answer: async (page) => {
            resolve(page);
            await settle();
          },
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
const live = {
  on: (kinds: readonly EventKind[]) =>
    messages.pipe(filter((m) => kinds.includes(m.kind as EventKind))),
  register: jest.fn(() => () => undefined),
  resync: new Subject<void>(),
};

@Component({
  imports: [ReviewsSection],
  template: `<section mf-reviews-section [garageId]="garageId()"></section>`,
})
class Host {
  readonly garageId = signal('g-1');
}

let fixture: ComponentFixture<Host>;

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  fixture?.detectChanges();
}

async function shown(page: GarageReviewsPageDto = PAGE) {
  reads = [];
  TestBed.configureTestingModule({
    providers: [
      { provide: ReviewsService, useValue: api },
      { provide: PublicLive, useValue: live },
      { provide: PLATFORM_ID, useValue: 'browser' },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(Host);
  await settle();
  await reads[0]?.answer(page);
}

const section = () =>
  fixture.nativeElement.querySelector('section') as HTMLElement;
const text = () => section().textContent?.replace(/\s+/g, ' ').trim() ?? '';
const reviews = () => [
  ...section().querySelectorAll<HTMLElement>('article.review'),
];
const button = (label: string) =>
  [...section().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(label),
  );

afterEach(() => {
  fixture?.destroy();
  api.reviewsControllerForGarage.mockClear();
  jest.useRealTimers();
});

describe('the reviews section under hostile answers', () => {
  it('renders markup in an author name and a job name as plain text', async () => {
    await shown({
      ...PAGE,
      items: [
        review(1, {
          author: { shortName: '<img src=x onerror=alert(1)> M.' },
          jobs: [{ id: 'j', nameEn: 'x', nameRo: '<script>1</script>' }],
        } as Partial<GarageReviewDto>),
      ],
    });

    expect(section().querySelector('img')).toBeNull();
    expect(section().querySelector('script')).toBeNull();
    expect(text()).toContain('<script>1</script>');
  });

  it('shows a one-word and a non-Latin author name as the answer gave them', async () => {
    await shown({
      ...PAGE,
      items: [
        review(1, { author: { shortName: 'Ștefan' } }),
        review(2, { author: { shortName: '李 王.' } }),
      ],
    });

    expect(
      reviews().map((r) => r.querySelector('.author')?.textContent?.trim()),
    ).toEqual(['Ștefan', '李 王.']);
  });

  it('puts only the car in the place when a job review has no included jobs', async () => {
    await shown({ ...PAGE, items: [review(1, { jobs: [] })] });

    expect(reviews()[0]?.querySelector('.about')?.textContent?.trim()).toBe(
      'BMW 320d',
    );
  });

  it('joins a hundred job names without dropping one', async () => {
    const jobs = Array.from({ length: 100 }, (_, i) => ({
      id: `j${i}`,
      jobTypeId: `t${i}`,
      nameEn: `E${i}`,
      nameRo: `Job${i}`,
      position: i,
    }));
    await shown({ ...PAGE, items: [review(1, { jobs })] });

    const about = reviews()[0]?.querySelector('.about')?.textContent ?? '';
    expect(about.split(', ')).toHaveLength(100);
  });

  it('keeps two reviews that share one text and one author as two rows', async () => {
    await shown({
      ...PAGE,
      breakdown: { five: 2, four: 0, one: 0, three: 0, two: 0 },
      items: [review(1), review(2)],
      total: 2,
    });

    expect(reviews()).toHaveLength(2);
  });

  it('answers a page past the last (no items, real total) with no review rows and no button', async () => {
    await shown({ ...PAGE, items: [], page: 9, total: 1 });

    expect(reviews()).toHaveLength(0);
    expect(button('Vezi mai multe')).toBeUndefined();
  });

  it('shows exactly 20 of 20 reviews with no button, and a button for 21', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => review(i + 1));
    await shown({ ...PAGE, items: twenty, total: 20 });
    expect(button('Vezi mai multe')).toBeUndefined();
    fixture.destroy();
    TestBed.resetTestingModule();

    await shown({ ...PAGE, items: twenty, total: 21 });
    expect(button('Vezi mai multe')).toBeDefined();
  });

  it('rounds a stored 4.25 to one decimal and shows a whole 3 as 3,0', async () => {
    await shown({ ...PAGE, rating: 3 } as GarageReviewsPageDto);
    expect(section().querySelector('.figure')?.textContent?.trim()).toBe('3,0');
  });

  it('dates a review posted just after midnight on 1 January in Bucharest by the new year', async () => {
    await shown({
      ...PAGE,
      items: [review(1, { postedAt: '2025-12-31T22:30:00.000Z' })],
    });

    expect(reviews()[0]?.querySelector('.month')?.textContent?.trim()).toBe(
      'ian. 2026',
    );
  });

  it('dates a review posted at 21:59 UTC on the last day of a summer month still in that month', async () => {
    await shown({
      ...PAGE,
      items: [review(1, { postedAt: '2026-07-31T20:59:00.000Z' })],
    });

    expect(reviews()[0]?.querySelector('.month')?.textContent?.trim()).toBe(
      'iul. 2026',
    );
  });

  it('shows the empty state, not the list, for a total of 0 even when a stale item arrives', async () => {
    await shown({
      ...PAGE,
      breakdown: { five: 0, four: 0, one: 0, three: 0, two: 0 },
      total: 0,
    });

    expect(text()).toContain('Încă nu are recenzii.');
  });

  it('shows the error line, not an empty state, when the first read is refused with 404', async () => {
    reads = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: ReviewsService, useValue: api },
        { provide: PublicLive, useValue: live },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    await TestBed.inject(I18n).enter('public');
    fixture = TestBed.createComponent(Host);
    await settle();
    await reads[0]?.fail(404);

    expect(text()).toContain('Nu am putut încărca recenziile');
    expect(text()).not.toContain('Încă nu are recenzii.');
  });

  it('does not read twice when the button is pressed twice before the page answers', async () => {
    const first = Array.from({ length: 20 }, (_, i) => review(i + 1));
    await shown({ ...PAGE, items: first, total: 40 });

    button('Vezi mai multe')?.click();
    await settle();
    button('Vezi mai multe')?.click();
    await settle();

    expect(reads).toHaveLength(2);
  });

  it('ignores a live message for a kind it does not list after the view is destroyed', async () => {
    jest.useFakeTimers();
    await shown();
    fixture.destroy();

    messages.next({
      at: '2026-10-08T12:00:00.000Z',
      id: 'x',
      kind: 'review.posted',
    });
    jest.advanceTimersByTime(1000);

    expect(reads).toHaveLength(1);
  });
});

// @traces 1367-FR-001
// @traces 1367-FR-003
// @traces 1367-FR-005
// @traces 1367-FR-007
describe('the price line and the marks under hostile answers', () => {
  const priceOf = () =>
    reviews()[0]
      ?.querySelector('.price')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
  const priced = (extra: Partial<GarageReviewDto>) =>
    shown({ ...PAGE, items: [review(1, extra)] });

  it('shows a final price of 0 bani as a value', async () => {
    await priced({
      finalPriceBani: 0,
      paidBani: null,
      quote: { fromBani: 380_000, toBani: 440_000 },
    });

    expect(priceOf()).toBe('Ofertă 3.800 – 4.400 lei · Final 0 lei');
  });

  it('shows both a zero final price and a one-bani amount paid', async () => {
    await priced({ finalPriceBani: 0, paidBani: 1, quote: null });

    expect(priceOf()).toBe('Final 0 lei · Plătit, după șofer: 0,01 lei');
  });

  it('shows a zero quote as a line', async () => {
    await priced({
      finalPriceBani: null,
      paidBani: null,
      quote: { fromBani: 0, toBani: 0 },
    });

    expect(priceOf()).toBe('Ofertă 0 lei');
  });

  it('shows the paid part when it differs from the final price by one bani', async () => {
    await priced({
      finalPriceBani: 420_000,
      paidBani: 420_001,
      quote: null,
    });

    expect(priceOf()).toBe(
      'Final 4.200 lei · Plătit, după șofer: 4.200,01 lei',
    );
  });

  it('draws only the final part when the answer leaves the other fields out', async () => {
    const {
      paidBani: _p,
      quote: _q,
      ...bare
    } = {
      ...REVIEW,
      finalPriceBani: 420_000,
    } as GarageReviewDto;
    await shown({ ...PAGE, items: [bare as GarageReviewDto] });

    expect(priceOf()).toBe('Final 4.200 lei');
  });

  it('draws no price line and no mark for an answer with none of the new fields', async () => {
    await shown({ ...PAGE, items: [REVIEW] });

    expect(reviews()[0]?.querySelector('.price')).toBeNull();
    expect(reviews()[0]?.querySelector('.edited')).toBeNull();
  });

  it('dates an edit made at 22:30 UTC on 31 December on the first of January', async () => {
    await priced({ editedAt: '2026-12-31T22:30:00.000Z' });

    expect(reviews()[0]?.querySelector('.edited')?.textContent).toContain(
      '1 ian. 2027',
    );
  });

  it('dates an edit made just before the spring clock change by its Bucharest day', async () => {
    await priced({ editedAt: '2026-03-28T22:30:00.000Z' });

    expect(reviews()[0]?.querySelector('.edited')?.textContent).toContain(
      '29 mart. 2026',
    );
  });

  it('hides every dot around the mark from assistive technology', async () => {
    await priced({ editedAt: '2026-10-05T09:30:00.000Z' });

    const by = reviews()[0]?.querySelector('.by') as HTMLElement;
    const visible = [...by.querySelectorAll('[aria-hidden="true"]')];
    expect(visible.map((e) => e.textContent)).toEqual(['·', '·', '·']);
  });

  it('shows the mark and no price line for a profile review that carries amounts and a stale car', async () => {
    await priced({
      car: { brand: 'BMW', model: '320d' },
      editedAt: '2026-10-05T09:30:00.000Z',
      finalPriceBani: 420_000,
      jobs: [{ id: 'j', nameEn: 'x', nameRo: 'Plăcuțe' }],
      paidBani: 450_000,
      quote: { fromBani: 380_000, toBani: 440_000 },
      source: 'profile',
    } as Partial<GarageReviewDto>);

    expect(reviews()[0]?.querySelector('.about')?.textContent?.trim()).toBe(
      'Nu prin MotorFix',
    );
    expect(reviews()[0]?.querySelector('.price')).toBeNull();
  });

  it('keeps a long Romanian line whole at the largest amounts', async () => {
    await priced({
      finalPriceBani: 1_420_000,
      paidBani: 1_450_000,
      quote: { fromBani: 1_380_000, toBani: 1_440_000 },
    });

    expect(priceOf()).toBe(
      'Ofertă 13.800 – 14.400 lei · Final 14.200 lei · Plătit, după șofer: 14.500 lei',
    );
  });
});
