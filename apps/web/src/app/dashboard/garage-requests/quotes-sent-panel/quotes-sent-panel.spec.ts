import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type GarageRequestListDto,
  GarageRequestsService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { QuotesSentPanel } from './quotes-sent-panel';
import { Live } from '../../live';
import { Session } from '../../session';
import {
  fakeLive,
  fakeObservers,
  listOf,
  quotedRow,
  wait,
} from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

type Answer = GarageRequestListDto | Promise<GarageRequestListDto>;

let live: ReturnType<typeof fakeLive>;
let list: jest.Mock;
let observers: ReturnType<typeof fakeObservers>;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const sentRows = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) =>
    quotedRow(
      { id: `req-q${from + i}` },
      { id: `quote-${from + i}`, sentAt: ago((from + i) * 60_000) },
    ),
  );

// The quoted first page answers in turn; further pages by cursor.
async function render(
  quoted: Answer[],
  {
    language = 'ro',
    pages = {},
    reduced = false,
  }: {
    language?: 'ro' | 'en';
    pages?: Record<string, GarageRequestListDto>;
    reduced?: boolean;
  } = {},
) {
  observers = fakeObservers();
  live = fakeLive();
  let call = 0;
  list = jest.fn(
    async ({ cursor, status }: { cursor?: string; status: string }) => {
      if (status !== 'quoted') return listOf([]);
      if (cursor) return pages[cursor];
      return quoted[Math.min(call++, quoted.length - 1)];
    },
  );
  const me = signal({
    capabilities: ['garage.requests'],
    garageId: 'garage-1',
  } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      GarageRequestsFeed,
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      { provide: REDUCED_MOTION, useValue: signal(reduced) },
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerList: list },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(QuotesSentPanel);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(0);
    }
  };
  await settle();
  return { element, settle };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('li[data-live-id]'),
];
const ids = (element: HTMLElement) =>
  rows(element).map((r) => r.dataset['liveId']);
const cursors = () =>
  list.mock.calls
    .map(([params]) => params)
    .filter((params) => params.cursor)
    .map((params) => params.cursor);

afterEach(() => TestBed.resetTestingModule());

// @traces 344-FR-014
// @traces 344-FR-017
describe('the Oferte trimise panel', () => {
  it('heads the quoted rows "Oferte trimise", newest sent first as the server sends them', async () => {
    const { element } = await render([listOf(sentRows(1, 3))]);

    expect(text(element.querySelector('h2'))).toBe('Oferte trimise');
    expect(ids(element)).toEqual(['req-q1', 'req-q2', 'req-q3']);
    expect(text(rows(element)[0])).toContain('Așteaptă răspunsul clientului');
  });

  it('heads it "Quotes sent" for an English reader', async () => {
    const { element } = await render([listOf(sentRows(1, 1))], {
      language: 'en',
    });

    expect(text(element.querySelector('h2'))).toBe('Quotes sent');
    expect(text(rows(element)[0])).toContain('Waiting for the customer');
  });

  it('shows three skeleton rows while the first read is on its way', async () => {
    const { element } = await render([
      new Promise<GarageRequestListDto>(() => undefined),
    ]);

    expect(element.querySelectorAll('.skeleton')).toHaveLength(3);
    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(rows(element)).toHaveLength(0);
  });

  it('says no quote has been sent yet, in both languages', async () => {
    const ro = await render([listOf([])]);
    expect(text(ro.element.querySelector('.empty'))).toBe(
      'Nicio ofertă trimisă încă.',
    );
    TestBed.resetTestingModule();

    const en = await render([listOf([])], { language: 'en' });
    expect(text(en.element.querySelector('.empty'))).toBe(
      'No quotes sent yet.',
    );
  });

  it('appends the next 20 when its end comes into view, while there is a next page', async () => {
    const { element, settle } = await render(
      [listOf(sentRows(1, 20), { nextCursor: 'q-2', total: 25 })],
      {
        pages: {
          'q-2': listOf(sentRows(21, 5), { total: 25 }),
        },
      },
    );
    expect(rows(element)).toHaveLength(20);

    observers.reachEnd();
    await settle();
    expect(cursors()).toEqual(['q-2']);
    expect(list).toHaveBeenCalledWith({ cursor: 'q-2', status: 'quoted' });
    expect(ids(element)).toEqual(sentRows(1, 25).map((r) => r.id));

    observers.reachEnd();
    await settle();
    expect(cursors()).toEqual(['q-2']);
  });
});

// @traces 344-FR-015
describe('the Oferte trimise panel kept current', () => {
  it('adds a sent quote at the top on quote.sent, keeps the rows shown and highlights only the new one', async () => {
    const shown = sentRows(1, 2);
    const { element, settle } = await render([
      listOf(shown),
      listOf([...sentRows(0, 1), ...shown]),
    ]);
    const kept = rows(element)[0];

    live.emit('quote.sent', 'quote-0');
    await wait(400);
    await settle();

    expect(ids(element)).toEqual(['req-q0', 'req-q1', 'req-q2']);
    expect(rows(element)[1]).toBe(kept);
    expect(rows(element)[0].classList).toContain('mf-live-changed');
    expect(rows(element)[1].classList).not.toContain('mf-live-changed');
    expect(rows(element)[2].classList).not.toContain('mf-live-changed');
  });

  it('shows a quote sent from this screen at once on a scrolled page, with no pill', async () => {
    const shown = sentRows(1, 2);
    const { element, settle } = await render([
      listOf(shown),
      listOf([...sentRows(0, 1), ...shown]),
    ]);
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 400,
    });

    try {
      TestBed.inject(GarageRequestsFeed).sent('req-q0');
      await settle();
    } finally {
      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        value: 0,
      });
    }

    expect(ids(element)).toEqual(['req-q0', 'req-q1', 'req-q2']);
    expect(element.querySelector('mf-live-pill button')).toBeNull();
  });

  it('highlights nothing on the first read', async () => {
    const { element } = await render([listOf(sentRows(1, 2))]);

    expect(element.querySelector('.mf-live-changed')).toBeNull();
  });

  it('highlights nothing with reduced motion', async () => {
    const { element, settle } = await render(
      [listOf(sentRows(1, 1)), listOf([...sentRows(0, 1), ...sentRows(1, 1)])],
      { reduced: true },
    );

    live.emit('quote.sent', 'quote-0');
    await wait(400);
    await settle();

    expect(ids(element)).toEqual(['req-q0', 'req-q1']);
    expect(element.querySelector('.mf-live-changed')).toBeNull();
  });
});
