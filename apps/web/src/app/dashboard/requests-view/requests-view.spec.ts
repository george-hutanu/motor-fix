import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

  it('says there is no request yet, with Cerere nouă to Home', async () => {
    const { element } = await render([[]]);

    expect(text(element)).toContain('Nicio cerere încă');
    const link = element.querySelector('a[href="/ro"]');
    expect(link && text(link)).toBe('Cerere nouă');
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
