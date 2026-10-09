import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type GarageRequestListDto,
  GarageRequestsService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GarageRequestsView } from './garage-requests-view';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, listOf, requestRow, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

// The sentinel's observer, fired by the test.
let observers: { callback: IntersectionObserverCallback; target?: Element }[];
class FakeObserver {
  private readonly entry: {
    callback: IntersectionObserverCallback;
    target?: Element;
  };
  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback };
    observers.push(this.entry);
  }
  observe(target: Element) {
    this.entry.target = target;
  }
  disconnect() {
    observers = observers.filter((o) => o !== this.entry);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

let live: ReturnType<typeof fakeLive>;
let list: jest.Mock;

const page = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) =>
    requestRow({
      createdAt: new Date(Date.now() - (from + i) * 60_000).toISOString(),
      id: `req-${from + i}`,
    }),
  );

// Answers by filter and cursor; the waiting first page answers in turn.
async function render(
  {
    closed = listOf([]),
    pages = {},
    waiting = [listOf(page(1, 20), { nextCursor: 'c-2', total: 45 })],
  }: {
    closed?: GarageRequestListDto;
    pages?: Record<string, GarageRequestListDto>;
    waiting?: GarageRequestListDto[];
  } = {},
  language: 'ro' | 'en' = 'ro',
) {
  observers = [];
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    FakeObserver;
  live = fakeLive();
  let first = 0;
  list = jest.fn(
    async ({ cursor, status }: { cursor?: string; status: string }) => {
      if (status === 'closed') return closed;
      if (cursor) return pages[cursor];
      return waiting[Math.min(first++, waiting.length - 1)];
    },
  );
  const me = signal({
    capabilities: ['garage.requests'],
    garageId: 'garage-1',
  } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      GarageRequestsFeed,
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerList: list },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(GarageRequestsView);
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

const waitingIds = (element: HTMLElement) =>
  [
    ...element.querySelectorAll<HTMLElement>(
      'li[data-live-id]:not([data-closed])',
    ),
  ].map((r) => r.dataset['liveId']);
const closedRows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('li[data-closed]'),
];
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// The list's end comes into view.
async function reachEnd(settle: () => Promise<void>) {
  for (const { callback, target } of observers) {
    callback(
      [
        {
          isIntersecting: true,
          target,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  }
  await settle();
}

const cursors = () =>
  list.mock.calls
    .map(([params]) => params)
    .filter((params) => params.status === 'waiting' && params.cursor)
    .map((params) => params.cursor);

afterEach(() => TestBed.resetTestingModule());

// @traces 343-FR-007
describe('the Cereri de ofertă view', () => {
  it('lists the waiting rows newest first, 20 at first', async () => {
    const { element } = await render();

    expect(waitingIds(element)).toEqual(page(1, 20).map((r) => r.id));
    expect(element.querySelector('mf-garage-requests-panel')).not.toBeNull();
    expect(text(element)).not.toContain('Vezi toate');
  });

  it('appends the next 20 when the list’s end comes into view, while there is a next page', async () => {
    const { element, settle } = await render({
      pages: {
        'c-2': listOf(page(21, 20), { nextCursor: 'c-3', total: 45 }),
        'c-3': listOf(page(41, 5), { total: 45 }),
      },
    });

    await reachEnd(settle);
    expect(cursors()).toEqual(['c-2']);
    expect(waitingIds(element)).toHaveLength(40);

    await reachEnd(settle);
    expect(cursors()).toEqual(['c-2', 'c-3']);
    expect(waitingIds(element)).toHaveLength(45);

    await reachEnd(settle);
    expect(cursors()).toEqual(['c-2', 'c-3']);
  });

  it('asks for nothing more when the first page has no next cursor', async () => {
    const { settle } = await render({
      waiting: [listOf(page(1, 3))],
    });

    await reachEnd(settle);

    expect(cursors()).toEqual([]);
  });

  it('drops a row of the next page already shown on the first', async () => {
    const { element, settle } = await render({
      pages: {
        'c-2': listOf([...page(20, 1), ...page(21, 3)], { total: 23 }),
      },
    });

    await reachEnd(settle);

    const ids = waitingIds(element);
    expect(ids).toHaveLength(23);
    expect(new Set(ids).size).toBe(23);
  });

  it('reads as many rows again as were shown when the list is read again', async () => {
    const { element, settle } = await render({
      pages: {
        'c-2': listOf(page(21, 20), { nextCursor: 'c-3', total: 45 }),
        'c-2b': listOf(page(20, 20), { nextCursor: 'c-3b', total: 46 }),
      },
      waiting: [
        listOf(page(1, 20), { nextCursor: 'c-2', total: 45 }),
        listOf(page(0, 20), { nextCursor: 'c-2b', total: 46 }),
      ],
    });
    await reachEnd(settle);
    expect(waitingIds(element)).toHaveLength(40);

    live.emit('request.created', 'req-0');
    await wait(400);
    await settle();

    expect(waitingIds(element)).toEqual(page(0, 40).map((r) => r.id));
    expect(cursors()).toEqual(['c-2', 'c-2b']);
  });

  it('drops a row that left the list beyond the first page when the list is read again', async () => {
    const { element, settle } = await render({
      pages: {
        'c-2': listOf(page(21, 20), { nextCursor: 'c-3', total: 45 }),
        'c-2b': listOf(page(22, 20), { nextCursor: 'c-3b', total: 44 }),
      },
      waiting: [
        listOf(page(1, 20), { nextCursor: 'c-2', total: 45 }),
        listOf(page(1, 20), { nextCursor: 'c-2b', total: 44 }),
      ],
    });
    await reachEnd(settle);

    live.emit('quote.sent', 'req-21');
    await wait(400);
    await settle();

    expect(waitingIds(element)).not.toContain('req-21');
    expect(waitingIds(element)).toHaveLength(40);
  });
});

// @traces 343-FR-004
// @traces 343-FR-007
describe('the closed rows of the last day', () => {
  const closed = listOf([
    requestRow({
      closedAt: new Date(Date.now() - 600_000).toISOString(),
      closedReason: 'cancelled',
      id: 'req-c1',
    }),
    requestRow({
      closedAt: new Date(Date.now() - 900_000).toISOString(),
      closedReason: 'accepted_elsewhere',
      id: 'req-c2',
    }),
  ]);

  it('shows them greyed under the waiting rows, each with its reason', async () => {
    const { element } = await render({
      closed,
      waiting: [listOf(page(1, 2))],
    });

    const rows = closedRows(element);
    expect(rows.map((r) => r.dataset['liveId'])).toEqual(['req-c1', 'req-c2']);
    expect(text(rows[0])).toContain('Cerere anulată de client');
    expect(text(rows[1])).toContain('Clientul a acceptat altă ofertă');
    const lastWaiting = element.querySelector(
      'li[data-live-id="req-2"]:not([data-closed])',
    );
    expect(
      lastWaiting &&
        lastWaiting.compareDocumentPosition(rows[0]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('labels them in English for an English reader', async () => {
    const { element } = await render({ closed }, 'en');

    expect(text(closedRows(element)[0])).toContain(
      'Request cancelled by the customer',
    );
    expect(text(closedRows(element)[1])).toContain(
      'The customer accepted another quote',
    );
  });

  it('gives them no action, and the counter counts only the waiting rows', async () => {
    const { element } = await render({
      closed,
      waiting: [listOf(page(1, 2))],
    });

    for (const row of closedRows(element)) {
      expect(row.querySelector('a, button')).toBeNull();
    }
    expect(text(element.querySelector('.counter'))).toBe('2 fără răspuns');
  });

  it('shows no closed heading when nothing closed in the last day', async () => {
    const { element } = await render({ closed: listOf([]) });

    expect(closedRows(element)).toHaveLength(0);
    expect(element.querySelector('.closed-heading')).toBeNull();
  });

  it('leaves the page title to the page and repeats no heading of its own', async () => {
    const { element } = await render({});

    expect(element.querySelector('.panel h2')).toBeNull();
    expect(text(element.querySelector('.counter'))).toBe('45 fără răspuns');
  });
});

// @traces 343-FR-016
describe('the closed rows’ contrast', () => {
  const root = join(__dirname, '../../../../../../..');
  const viewCss = readFileSync(
    join(__dirname, 'garage-requests-view.css'),
    'utf8',
  );
  const cockpit = readFileSync(
    join(root, 'libs/ui-cockpit/src/styles/cockpit.css'),
    'utf8',
  );

  // The index of the brace that closes the one at `start`.
  const STEP: Record<string, number> = { '{': 1, '}': -1 };
  const closing = (source: string, start: number) => {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
      depth += STEP[source[i]] ?? 0;
      if (depth === 0) return i;
    }
    return -1;
  };
  const block = (source: string, opener: RegExp) => {
    const match = opener.exec(source);
    if (!match) throw new Error(`no block for ${opener}`);
    const start = source.indexOf('{', match.index);
    const end = closing(source, start);
    if (end === -1) throw new Error(`unclosed block for ${opener}`);
    return source.slice(start + 1, end);
  };
  const token = (source: string, name: string) =>
    new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(source)?.[1] ?? '';
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it('greys them with the secondary text colour, never with opacity', () => {
    const rules = [
      ...viewCss.matchAll(/([^{}]*\[data-closed\][^{]*)\{([^}]*)\}/g),
    ];
    expect(rules.length).toBeGreaterThan(0);
    const declarations = rules.map(([, , body]) => body).join(';');
    expect(declarations).toMatch(/color:\s*var\(--mf-text-secondary\)/);
    expect(declarations).not.toMatch(/opacity|filter/);
    expect(viewCss).not.toMatch(/opacity/);
  });

  it.each([
    ['dark', () => block(cockpit.replace(/@media[\s\S]*$/, ''), /:root\s*\{/)],
    [
      'light',
      () =>
        block(
          block(cockpit, /@media\s*\(prefers-color-scheme:\s*light\)[^{]*/),
          /:root/,
        ),
    ],
  ])('reads at 4.5:1 or more on the panel in %s', (_, scheme) => {
    const tokens = scheme();
    const text = token(tokens, '--mf-text-secondary');
    const panel = token(tokens, '--mf-panel');

    expect(contrast(text, panel)).toBeGreaterThanOrEqual(4.5);
  });
});
