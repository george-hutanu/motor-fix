import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type RequestSummaryDto,
  RequestsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { RequestsView } from './requests-view';
import { Live } from '../live';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const row = (over: Partial<RequestSummaryDto> = {}): RequestSummaryDto => ({
  car: {
    brand: 'Dacia',
    engine: null,
    fuel: 'petrol',
    model: 'Logan',
    year: 2017,
  },
  closedAt: null,
  closedReason: null,
  createdAt: new Date(Date.now() - 5_000).toISOString(),
  description: null,
  expiresAt: '2026-10-16T09:00:00.000Z',
  id: 'req-1',
  jobs: [
    {
      id: 'rj-1',
      jobTypeId: 'job-oil',
      nameEn: 'Oil change',
      nameRo: 'Schimb ulei',
      position: 1,
    },
  ],
  quotesCount: 0,
  status: 'sent',
  ...over,
});

let events: Subject<LiveMessage>;
let list: jest.Mock;

async function render(
  answers: (RequestSummaryDto[] | Error)[],
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  let call = 0;
  list = jest.fn(async () => {
    const items = answers[Math.min(call++, answers.length - 1)];
    if (items instanceof Error) throw items;
    return { items, nextCursor: null, total: items.length };
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: RequestsService, useValue: { requestsControllerList: list } },
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync: new Subject<void>(),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(RequestsView);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(0);
    }
  };
  await settle();
  return { element, settle };
}

const text = (el: Element) =>
  (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-request]'),
];

afterEach(() => TestBed.resetTestingModule());

// @traces 221-FR-014, 221-SC-002
describe('Cererile mele', () => {
  it('shows each request with its car, jobs, status and how long ago, in the order read', async () => {
    const { element } = await render([
      [
        row(),
        row({
          createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          description: 'Scârțâie la frânare\nmai ales dimineața',
          id: 'req-0',
          jobs: [],
          status: 'quoted',
        }),
      ],
    ]);

    const [first, second] = rows(element);
    expect(text(first)).toContain('Dacia Logan 2017');
    expect(text(first)).toContain('Schimb ulei');
    expect(text(first)).toContain('Trimisă');
    expect(text(first)).toContain('acum câteva secunde');
    expect(text(second)).toContain('Scârțâie la frânare');
    expect(text(second)).not.toContain('dimineața');
    expect(text(second)).toContain('Ofertă');
    expect(text(second)).toContain('acum 3 ore');
  });

  it('names the jobs and the status in English for an English reader', async () => {
    const { element } = await render([[row()]], 'en');

    const [first] = rows(element);
    expect(text(first)).toContain('Oil change');
    expect(text(first)).toContain('Sent');
    expect(text(first)).toContain('a few seconds ago');
  });

  // @traces 030-FR-009
  it('says there is no request yet in the shared empty state, with Caută un service to Home', async () => {
    const { element } = await render([[]]);

    const empty = element.querySelector('mf-empty-state') as HTMLElement;
    expect(text(empty)).toContain(
      'Nicio cerere încă. Cere oferte de la mai multe service‑uri deodată.',
    );
    expect(empty.querySelector('svg[data-icon="inbox"]')).not.toBeNull();
    const link = empty.querySelector('a[href="/ro"]');
    expect(link && text(link)).toBe('Caută un service');
    expect(text(element)).not.toContain('Cerere nouă');
  });

  // @traces 030-FR-009
  it('says it in English for an English reader', async () => {
    const { element } = await render([[]], 'en');

    const empty = element.querySelector('mf-empty-state') as HTMLElement;
    expect(text(empty)).toContain(
      'No requests yet. Ask several garages for a quote at once.',
    );
    const link = empty.querySelector('a[href="/en"]');
    expect(link && text(link)).toBe('Find a garage');
  });

  it('reads the list again when a request is created elsewhere', async () => {
    const { element, settle } = await render([[], [row()]]);
    expect(rows(element)).toHaveLength(0);

    events.next({
      at: new Date().toISOString(),
      id: 'req-1',
      kind: 'request.created',
    });
    await wait(400);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(rows(element)).toHaveLength(1);
  });

  // @traces 344-FR-015
  it('reads the list again when a garage sends a quote', async () => {
    const { element, settle } = await render([
      [row()],
      [row({ quotesCount: 1, status: 'quoted' })],
    ]);

    events.next({
      at: new Date().toISOString(),
      id: 'quote-1',
      kind: 'quote.sent',
    });
    await wait(400);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(text(rows(element)[0])).toContain('Ofertă');
  });

  // @traces 345-FR-016
  it('reads the list again when a garage’s decline window closes', async () => {
    await render([[row()], [row()]]);

    events.next({
      at: new Date().toISOString(),
      id: 'rr-1',
      kind: 'request.declined',
    });
    await wait(400);

    expect(list).toHaveBeenCalledTimes(2);
  });

  // @traces 345-FR-016
  it('reads nothing again for an undone decline, which the driver never saw', async () => {
    await render([[row()], [row()]]);

    events.next({
      at: new Date().toISOString(),
      id: 'rr-1',
      kind: 'request.decline_undone',
    });
    await wait(400);

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the first read fails, and shows the list after it', async () => {
    const { element, settle } = await render([new Error('down'), [row()]]);

    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    const retry = [...element.querySelectorAll('button')].find(
      (b) => text(b) === 'Încearcă din nou',
    );
    retry?.click();
    await settle();

    expect(rows(element)).toHaveLength(1);
  });
});

describe('Cererile mele opened at a request', () => {
  let scrolled: jest.Mock;

  async function open(url: string) {
    events = new Subject();
    scrolled = jest.fn();
    Element.prototype.scrollIntoView = scrolled;
    list = jest.fn(async () => {
      const items = [row(), row({ id: 'req-2' })];
      return { items, nextCursor: null, total: items.length };
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            children: [{ component: RequestsView, path: '**' }],
            path: 'requests',
          },
        ]),
        {
          provide: RequestsService,
          useValue: { requestsControllerList: list },
        },
        {
          provide: Live,
          useValue: {
            events,
            on: (kinds: readonly EventKind[]) =>
              events.pipe(
                filter((m) => (kinds as readonly string[]).includes(m.kind)),
              ),
            resync: new Subject<void>(),
          },
        },
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settled(harness);
    return harness;
  }

  async function settled(harness: RouterTestingHarness) {
    for (let i = 0; i < 4; i++) {
      harness.detectChanges();
      await harness.fixture.whenStable();
      await wait(0);
    }
  }

  const focused = () =>
    (document.activeElement as HTMLElement | null)?.getAttribute(
      'data-request',
    );

  // @traces 032-FR-004
  it('scrolls the request named in the address into view and focuses its row', async () => {
    await open('/requests/req-2');

    expect(focused()).toBe('req-2');
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(document.activeElement);
  });

  // @traces 032-FR-004
  it('does not scroll again when the list is read again live', async () => {
    const harness = await open('/requests/req-2');

    events.next({
      at: new Date().toISOString(),
      id: 'req-3',
      kind: 'request.created',
    });
    await wait(400);
    await settled(harness);

    expect(list).toHaveBeenCalledTimes(2);
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  // @traces 032-FR-004 032-FR-005
  it('opens at the top with nothing focused for a request not listed', async () => {
    await open('/requests/gone');

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });
});
