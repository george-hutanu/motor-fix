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
  reply: null,
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
const button = (label: string) =>
  [...section().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(label),
  );

afterEach(() => {
  fixture?.destroy();
  jest.useRealTimers();
});

const REPLY = {
  editedAt: null,
  postedAt: '2026-10-12T09:00:00.000Z',
  text: 'Mulțumim, Andrei!',
};
// Reads the typographic apostrophe and no-break hyphen as their plain forms.
const calm = (value?: string | null) =>
  value
    ?.replace(/\s+/g, ' ')
    .replace(/\u2019/g, "'")
    .replace(/\u2011/g, '-')
    .trim() ?? '';
const blocks = () => [
  ...section().querySelectorAll<HTMLElement>('[data-reply]'),
];
const inReply = (name: string, index = 0) =>
  calm(blocks()[index]?.querySelector(`[data-${name}]`)?.textContent);

// @traces 1387-FR-004 1387-FR-005
describe('the garage’s reply on the profile in English', () => {
  beforeEach(() => configure());

  it('reads “The garage’s reply”, the day and the edit mark in English from the first paint', async () => {
    await open();
    await english();
    await reads[0]?.answer({
      ...PAGE,
      items: [
        review(1, {
          reply: { ...REPLY, editedAt: '2026-10-14T09:00:00.000Z' },
        }),
      ],
    });

    expect(calm(blocks()[0]?.querySelector('.reply-label')?.textContent)).toBe(
      "The garage's reply",
    );
    expect(inReply('reply-day')).toBe('12 Oct 2026');
    expect(inReply('reply-edited')).toBe('Edited · 14 Oct 2026');
  });

  it('changes the reply’s words with the language and keeps its text', async () => {
    await shown({ ...PAGE, items: [review(1, { reply: REPLY })] });
    const before = calm(
      blocks()[0]?.querySelector('.reply-label')?.textContent,
    );

    await english();

    expect(before).toBe('Răspunsul service-ului');
    expect(calm(blocks()[0]?.querySelector('.reply-label')?.textContent)).toBe(
      "The garage's reply",
    );
    expect(inReply('reply-text')).toBe('Mulțumim, Andrei!');
  });
});

// @traces 1387-FR-004
describe('what the profile’s reply never shows', () => {
  beforeEach(() => configure());

  it('carries none of the owner’s marks, even when the review was edited after the reply', async () => {
    await shown({
      ...PAGE,
      items: [
        review(1, {
          editedAt: '2026-10-20T09:00:00.000Z',
          reply: REPLY,
        }),
      ],
    });

    const reply = calm(blocks()[0]?.textContent);
    expect(reply).not.toContain('Raportat');
    expect(reply).not.toContain('Recenzia a fost editată');
    expect(reply).not.toContain('Editat');
    expect(blocks()[0]?.querySelector('[data-review-edited-after]')).toBeNull();
    expect(blocks()[0]?.querySelector('button')).toBeNull();
  });

  it('keeps the reply’s edit mark apart from the review’s own “Editată” mark', async () => {
    await shown({
      ...PAGE,
      items: [
        review(1, {
          editedAt: '2026-10-20T09:00:00.000Z',
          reply: REPLY,
        }),
      ],
    });

    expect(inReply('reply-edited')).toBe('');
    expect(calm(reviews()[0]?.textContent)).toContain('Editată · 20 oct. 2026');
    expect(calm(blocks()[0]?.textContent)).not.toContain('Editată');
  });

  it('shows an edited reply of a never edited review with only the reply’s mark', async () => {
    await shown({
      ...PAGE,
      items: [
        review(1, {
          reply: { ...REPLY, editedAt: '2026-10-14T09:00:00.000Z' },
        }),
      ],
    });

    expect(inReply('reply-edited')).toBe('Editat · 14 oct. 2026');
    expect(calm(reviews()[0]?.textContent)).not.toContain('Editată');
  });

  it('offers no way to answer or edit from the profile', async () => {
    await shown({ ...PAGE, items: [review(1, { reply: REPLY })] });

    expect(
      [...section().querySelectorAll('button')].map((b) => calm(b.textContent)),
    ).not.toContain('Răspunde');
    expect(text()).not.toContain('Editează răspunsul');
  });
});

// @traces 1387-FR-004
describe('the profile’s reply under hostile answers', () => {
  beforeEach(() => configure());

  it('draws no block for an answer that leaves the reply out, as an older server does', async () => {
    const { reply: _gone, ...older } = review(1);
    await shown({ ...PAGE, items: [older as GarageReviewDto] });

    expect(blocks()).toHaveLength(0);
    expect(reviews()).toHaveLength(1);
  });

  it('draws no block for a reply set to undefined, and none for null', async () => {
    await shown({
      ...PAGE,
      items: [
        review(1, { reply: undefined as never }),
        review(2, { reply: null }),
      ],
    });

    expect(reviews()).toHaveLength(2);
    expect(blocks()).toHaveLength(0);
  });

  it('puts the block under the review that has the reply and no other', async () => {
    await shown({
      ...PAGE,
      items: [
        review(1),
        review(2, { reply: { ...REPLY, text: 'Doar al doilea' } }),
        review(3),
      ],
    });

    expect(
      reviews().map((r) => r.querySelector('[data-reply]') !== null),
    ).toEqual([false, true, false]);
    expect(inReply('reply-text')).toBe('Doar al doilea');
  });

  it('shows a 1,000 character reply with no break opportunity in full and links as text', async () => {
    const long = `${'x'.repeat(990)} https://exemplu.ro/a`;
    await shown({
      ...PAGE,
      items: [review(1, { reply: { ...REPLY, text: long } })],
    });

    expect(blocks()[0]?.querySelector('[data-reply-text]')?.textContent).toBe(
      long,
    );
    expect(blocks()[0]?.querySelector('a')).toBeNull();
  });

  it('keeps tags, entities and blank lines as typed', async () => {
    const typed = '<img src=x onerror=alert(1)>&amp;\n\n<script>1</script>';
    await shown({
      ...PAGE,
      items: [review(1, { reply: { ...REPLY, text: typed } })],
    });

    const el = blocks()[0]?.querySelector('[data-reply-text]');
    expect(el?.textContent).toBe(typed);
    expect(blocks()[0]?.querySelector('img, script')).toBeNull();
  });

  it('shows emoji and right-to-left text whole', async () => {
    const typed = 'Mulțumim 😀👍🏽 شكرا';
    await shown({
      ...PAGE,
      items: [review(1, { reply: { ...REPLY, text: typed } })],
    });

    expect(inReply('reply-text')).toBe(typed);
  });

  it('dates a reply posted at 22:30 UTC on 31 December on the first of January', async () => {
    await shown({
      ...PAGE,
      items: [
        review(1, {
          reply: { ...REPLY, postedAt: '2026-12-31T22:30:00.000Z' },
        }),
      ],
    });

    expect(inReply('reply-day')).toBe('1 ian. 2027');
  });

  it('marks an edit that carries the very instant of the posting', async () => {
    await shown({
      ...PAGE,
      items: [
        review(1, {
          reply: { ...REPLY, editedAt: '2026-10-12T09:00:00.000Z' },
        }),
      ],
    });

    expect(inReply('reply-edited')).toBe('Editat · 12 oct. 2026');
  });

  it('shows the reply of a review that arrives on the second page', async () => {
    await open();
    await reads[0]?.answer({
      ...PAGE,
      items: [review(1)],
      pageSize: 1,
      total: 2,
    });
    button('Vezi mai multe')?.click();
    await settle();
    await reads[1]?.answer({
      ...PAGE,
      items: [review(2, { reply: { ...REPLY, text: 'Pe pagina a doua' } })],
      page: 2,
      pageSize: 1,
      total: 2,
    });

    expect(blocks()).toHaveLength(1);
    expect(inReply('reply-text')).toBe('Pe pagina a doua');
  });
});

// @traces 1387-FR-004
describe('the profile’s reply kept live', () => {
  beforeEach(() => {
    configure();
    jest.useFakeTimers();
  });

  it('drops the reply and keeps the review when the re-read no longer carries it', async () => {
    await shown({ ...PAGE, items: [review(1, { reply: REPLY })] });
    expect(blocks()).toHaveLength(1);

    await liveMessage('review.reported');
    await reads[1]?.answer({ ...PAGE, items: [review(1)] });

    expect(blocks()).toHaveLength(0);
    expect(reviews()).toHaveLength(1);
  });

  it('drops the review and its reply together when the re-read no longer lists it', async () => {
    await shown({ ...PAGE, items: [review(1, { reply: REPLY })] });

    await liveMessage('review.decided');
    await reads[1]?.answer({ ...PAGE, items: [], reviewCount: 0, total: 0 });

    expect(blocks()).toHaveLength(0);
    expect(reviews()).toHaveLength(0);
  });

  it('shows the new text and the edit mark when a reply is edited', async () => {
    await shown({ ...PAGE, items: [review(1, { reply: REPLY })] });

    await liveMessage('review.reply_edited');
    await reads[1]?.answer({
      ...PAGE,
      items: [
        review(1, {
          reply: {
            ...REPLY,
            editedAt: '2026-10-14T09:00:00.000Z',
            text: 'Text nou',
          },
        }),
      ],
    });

    expect(inReply('reply-text')).toBe('Text nou');
    expect(inReply('reply-edited')).toBe('Editat · 14 oct. 2026');
  });

  it('reads once for a reply and an edit sent in one burst', async () => {
    await shown();

    send('review.replied');
    send('review.reply_edited');
    jest.advanceTimersByTime(300);
    await settle();

    expect(reads).toHaveLength(2);
  });

  it('keeps a shown reply when the re-read after it fails', async () => {
    await shown({ ...PAGE, items: [review(1, { reply: REPLY })] });

    await liveMessage('review.reply_edited');
    await reads[1]?.fail(500);

    expect(inReply('reply-text')).toBe('Mulțumim, Andrei!');
  });
});
