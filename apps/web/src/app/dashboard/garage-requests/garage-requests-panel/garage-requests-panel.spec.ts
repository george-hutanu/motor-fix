import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type GarageRequestListDto,
  GarageRequestsService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GarageRequestsPanel } from './garage-requests-panel';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, listOf, requestRow, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

@Component({
  imports: [GarageRequestsPanel],
  template: '<mf-garage-requests-panel [limit]="limit()" />',
})
class Host {
  readonly limit = input<number | undefined>(undefined);
}

type Answer = GarageRequestListDto | Error | Promise<GarageRequestListDto>;

let live: ReturnType<typeof fakeLive>;
let list: jest.Mock;

async function render(
  waiting: Answer[],
  { language = 'ro', limit }: { language?: 'ro' | 'en'; limit?: number } = {},
) {
  live = fakeLive();
  let call = 0;
  list = jest.fn(async ({ status }: { status: string }) => {
    if (status === 'closed') return listOf([]);
    const answer = waiting[Math.min(call++, waiting.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  });
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
  const announce = jest
    .spyOn(TestBed.inject(LiveAnnouncer), 'announce')
    .mockResolvedValue();
  const fixture = TestBed.createComponent(Host);
  if (limit !== undefined) fixture.componentRef.setInput('limit', limit);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(0);
    }
  };
  await settle();
  return { announce, element, settle };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('li[data-live-id]'),
];
const counter = (element: HTMLElement) =>
  element.querySelector<HTMLElement>('.counter');
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

// @traces 343-FR-008
describe('the requests panel rows', () => {
  it('shows the short name, the car with its year, the jobs, any mechanic and the age, in that order', async () => {
    const created = ago(12 * 60_000);
    const { element } = await render([
      listOf([
        requestRow({
          createdAt: created,
          driver: { shortName: 'Vlad P.' },
          jobs: [
            {
              id: 'rj-1',
              jobTypeId: 'job-brakes',
              nameEn: 'Front brakes',
              nameRo: 'Frâne față',
              offered: true,
              position: 0,
            },
            {
              id: 'rj-2',
              jobTypeId: 'job-ac',
              nameEn: 'AC check',
              nameRo: 'Diagnoză climă',
              offered: false,
              position: 1,
            },
          ],
        }),
      ]),
    ]);

    const [row] = rows(element);
    expect(row.dataset['liveId']).toBe('req-1');
    expect(text(row)).toBe(
      'Vlad P. Dacia Logan · 2018 Frâne față · Diagnoză climă · nu faceți orice mecanic acum 12 min',
    );
    expect(row.querySelector('time')?.getAttribute('datetime')).toBe(created);
  });

  it('shows the description’s first line when the request has no job', async () => {
    const { element } = await render([
      listOf([
        requestRow({
          descriptionLine: 'Scârțâie la frânare',
          jobs: [],
        }),
      ]),
    ]);

    expect(text(rows(element)[0])).toContain('Scârțâie la frânare');
  });

  it('writes the row in English for an English reader', async () => {
    const { element } = await render(
      [
        listOf([
          requestRow({
            createdAt: ago(3 * 3_600_000),
            jobs: [
              {
                id: 'rj-1',
                jobTypeId: 'job-oil',
                nameEn: 'Oil and filter change',
                nameRo: 'Schimb de ulei și filtre',
                offered: false,
                position: 0,
              },
            ],
          }),
        ]),
      ],
      { language: 'en' },
    );

    expect(text(rows(element)[0])).toBe(
      'Vlad P. Dacia Logan · 2018 Oil and filter change · not offered any mechanic 3 hours ago',
    );
    expect(text(element.querySelector('h2'))).toBe('Quote requests');
    expect(text(counter(element))).toBe('1 unanswered');
  });

  it('keeps the newest first, as the server sends them', async () => {
    const { element } = await render([
      listOf([
        requestRow({ createdAt: ago(60_000), id: 'req-2' }),
        requestRow({ createdAt: ago(2 * 3_600_000), id: 'req-1' }),
      ]),
    ]);

    expect(rows(element).map((r) => r.dataset['liveId'])).toEqual([
      'req-2',
      'req-1',
    ]);
  });

  it('brings the age up to date at least once a minute', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    const created = new Date(Date.now() - 30_000).toISOString();
    const pending = render([listOf([requestRow({ createdAt: created })])]);
    await jest.advanceTimersByTimeAsync(10);
    const { element, settle } = await pending;
    expect(text(element.querySelector('time'))).toBe('acum câteva secunde');

    await jest.advanceTimersByTimeAsync(61_000);
    const done = settle();
    await jest.advanceTimersByTimeAsync(10);
    await done;

    expect(text(element.querySelector('time'))).toBe('acum 1 min');
  });
});

// @traces 343-FR-011
describe('the requests panel states', () => {
  it('shows three skeleton rows and no counter while the first read is on its way', async () => {
    const { element } = await render([
      new Promise<GarageRequestListDto>(() => undefined),
    ]);

    expect(element.querySelectorAll('.skeleton')).toHaveLength(3);
    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(counter(element)).toBeNull();
    expect(text(element.querySelector('h2'))).toBe('Cereri de ofertă');
  });

  it('says there is no new request, with the counter at 0', async () => {
    const { element } = await render([listOf([])]);

    expect(text(element)).toContain(
      'Nicio cerere nouă. Te anunțăm când apare una.',
    );
    expect(text(counter(element))).toBe('0 fără răspuns');
    expect(rows(element)).toHaveLength(0);
  });

  it('writes the counter the same way for any number', async () => {
    const { element } = await render([listOf([requestRow()], { total: 1 })]);
    expect(text(counter(element))).toBe('1 fără răspuns');
    TestBed.resetTestingModule();

    const many = await render([listOf([requestRow()], { total: 23 })]);
    expect(text(counter(many.element))).toBe('23 fără răspuns');
  });

  it('shows the reconnecting banner while the stream reconnects or polls, above the list', async () => {
    const { element, settle } = await render([listOf([requestRow()])]);
    const banner = () => element.querySelector('.reconnecting');
    expect(banner()).toBeNull();

    live.state.set('reconnecting');
    await settle();
    expect(text(banner())).toBe('Reconectare…');
    expect(
      (banner()?.compareDocumentPosition(rows(element)[0]) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    live.state.set('polling');
    await settle();
    expect(text(banner())).toBe('Reconectare…');

    live.state.set('open');
    await settle();
    expect(banner()).toBeNull();
  });

  it('keeps the last list with "Lista poate fi veche" once offline', async () => {
    const { element, settle } = await render([listOf([requestRow()])]);

    live.offline.set(true);
    await settle();

    expect(text(element)).toContain('Lista poate fi veche');
    expect(rows(element)).toHaveLength(1);
  });

  it('shows the shared error with a retry when the first read fails, and the list after it', async () => {
    const { element, settle } = await render([
      new Error('down'),
      listOf([requestRow()]),
    ]);

    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect(counter(element)).toBeNull();
    const retry = [...element.querySelectorAll('button')].find(
      (b) => text(b) === 'Încearcă din nou',
    );
    retry?.click();
    await settle();

    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(rows(element)).toHaveLength(1);
  });

  it('keeps the list when a later read fails', async () => {
    const { element, settle } = await render([
      listOf([requestRow()]),
      new Error('down'),
    ]);

    live.emit('quote.sent', 'req-1');
    await wait(400);
    await settle();

    expect(list).toHaveBeenCalledWith({ status: 'waiting' });
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(rows(element)).toHaveLength(1);
  });
});

// @traces 343-FR-009
describe('the requests panel kept current', () => {
  it('adds a new request at the top without a reload and announces the counter politely', async () => {
    const { announce, element, settle } = await render([
      listOf([requestRow({ id: 'req-1' })]),
      listOf([
        requestRow({ createdAt: ago(1_000), id: 'req-2' }),
        requestRow({ id: 'req-1' }),
      ]),
    ]);
    const first = rows(element)[0];

    live.emit('request.created', 'req-2');
    await wait(400);
    await settle();

    expect(rows(element).map((r) => r.dataset['liveId'])).toEqual([
      'req-2',
      'req-1',
    ]);
    expect(rows(element)[1]).toBe(first);
    expect(text(counter(element))).toBe('2 fără răspuns');
    expect(announce).toHaveBeenCalledWith('2 fără răspuns', 'polite');
  });
});

// @traces 343-FR-006
describe('the requests panel with a limit', () => {
  const five = Array.from({ length: 5 }, (_, i) =>
    requestRow({ createdAt: ago((i + 1) * 60_000), id: `req-${i + 1}` }),
  );

  it('shows the four newest and "Vezi toate" to the view when there are more', async () => {
    const { element } = await render([listOf(five, { total: 5 })], {
      limit: 4,
    });

    expect(rows(element).map((r) => r.dataset['liveId'])).toEqual([
      'req-1',
      'req-2',
      'req-3',
      'req-4',
    ]);
    const all = element.querySelector<HTMLAnchorElement>(
      'a[href="/app/garage/requests"]',
    );
    expect(text(all)).toBe('Vezi toate');
    expect(text(counter(element))).toBe('5 fără răspuns');
  });

  it('has no "Vezi toate" with four rows or fewer', async () => {
    const { element } = await render([listOf(five.slice(0, 4))], {
      limit: 4,
    });

    expect(rows(element)).toHaveLength(4);
    expect(element.querySelector('a[href="/app/garage/requests"]')).toBeNull();
  });

  it('says "See all" in English', async () => {
    const { element } = await render([listOf(five)], {
      language: 'en',
      limit: 4,
    });

    expect(text(element.querySelector('a[href="/app/garage/requests"]'))).toBe(
      'See all',
    );
  });
});
