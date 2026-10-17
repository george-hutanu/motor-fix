import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  GaragesService,
  type MeDto,
  type PriceListDto,
  type PriceListItemDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { PricesView } from './prices-view';
import { Live } from '../live';
import { Session } from '../session';

const GARAGE = 'garage-1';

const item = (over: Partial<PriceListItemDto> = {}): PriceListItemDto => ({
  brandRanges: [],
  durationMinutes: 30,
  fromBani: 15_000,
  jobTypeId: 'diagnosis',
  nameEn: 'Diagnosis and fault-code read',
  nameRo: 'Diagnoză și citire coduri de eroare',
  public: true,
  toBani: 22_000,
  ...over,
});

// Service Auto Militari's list as the seed holds it.
const SEEDED: PriceListItemDto[] = [
  item(),
  item({
    durationMinutes: 60,
    fromBani: 25_000,
    jobTypeId: 'oil',
    nameEn: 'Oil and filter service',
    nameRo: 'Schimb de ulei și filtre',
    toBani: 40_000,
  }),
  item({
    brandRanges: [
      { brandId: 'bmw', fromBani: 110_000, name: 'BMW', toBani: 170_000 },
    ],
    durationMinutes: 120,
    fromBani: 89_000,
    jobTypeId: 'brakes',
    nameEn: 'Front brake pads and discs',
    nameRo: 'Plăcuțe și discuri de frână față',
    toBani: 140_000,
  }),
  item({
    durationMinutes: 480,
    fromBani: 420_000,
    jobTypeId: 'chain',
    nameEn: 'Timing chain kit',
    nameRo: 'Kit lanț de distribuție',
    toBani: 680_000,
  }),
  item({
    durationMinutes: 45,
    fromBani: 28_000,
    jobTypeId: 'ac',
    nameEn: 'Air-con regas',
    nameRo: 'Încărcare freon climă',
    toBani: 36_000,
  }),
  item({
    durationMinutes: 90,
    fromBani: 35_000,
    jobTypeId: 'suspension',
    nameEn: 'Suspension check and alignment',
    nameRo: 'Verificare suspensie și geometrie',
    public: false,
    reason: 'no_top_price',
    toBani: undefined,
  }),
];

const LABOUR = { fromBani: 18_000, toBani: 24_000 };

const me = {
  garageAccess: [{ garageId: GARAGE, role: 'owner' }],
  garageId: GARAGE,
} as unknown as MeDto;

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let read: jest.Mock;

async function render(
  answer: () => Promise<PriceListDto> = async () => ({
    items: SEEDED,
    labour: LABOUR,
  }),
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  resync = new Subject();
  read = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      { provide: GaragesService, useValue: { priceListControllerRead: read } },
      { provide: Session, useValue: { shown: signal(me) } },
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
  const fixture = TestBed.createComponent(PricesView);
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

const text = (element: Element | null) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-row]'),
];
const cell = (row: HTMLElement, name: string) =>
  text(row.querySelector(`[data-${name}]`));
const brandLines = (row: HTMLElement) =>
  [...row.querySelectorAll('[data-brand]')].map(text);
const message = (kind: string, id: string): LiveMessage => ({
  at: '2026-10-18T09:00:00.000Z',
  id,
  kind,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => TestBed.resetTestingModule());

// @traces 172-FR-001 172-FR-002
// @traces 172-FR-003 172-FR-005
// @traces 172-FR-006 172-FR-010
describe('Prețuri: every job with its state', () => {
  it("reads the session garage's list once and shows its title and one list item per job, in the read's order", async () => {
    const { element, settle } = await render();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ garageId: GARAGE });
    expect(text(element.querySelector('h2'))).toBe('Lista de prețuri');
    const shown = rows(element);
    expect(shown.map((row) => row.tagName)).toEqual(Array(6).fill('LI'));
    expect(shown.map((row) => cell(row, 'name'))).toEqual(
      SEEDED.map((row) => row.nameRo),
    );
  });

  it('shows each job its duration, its state with a lamp and its range, the hidden one amber with its reason and a starting price', async () => {
    const { element, settle } = await render();
    await settle();

    const shown = rows(element);
    expect(shown.map((row) => cell(row, 'duration'))).toEqual([
      '30 min',
      '1 h',
      '2 h',
      '1 zi',
      '45 min',
      '1 h 30',
    ]);
    expect(shown.map((row) => cell(row, 'state'))).toEqual([
      ...Array(5).fill('pe profil'),
      'ascuns · fără preț maxim',
    ]);
    expect(shown.map((row) => row.dataset['public'])).toEqual([
      ...Array(5).fill('true'),
      'false',
    ]);
    expect(cell(shown[0], 'price')).toBe('150–220 lei');
    expect(cell(shown[5], 'price')).toBe('de la 350 lei');
    const lamp = shown[5].querySelector('[data-lamp]');
    expect(lamp).not.toBeNull();
    expect(lamp?.getAttribute('aria-hidden')).toBe('true');
  });

  it('speaks English in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    const shown = rows(element);
    expect(text(element.querySelector('h2'))).toBe('Price list');
    expect(cell(shown[0], 'name')).toBe('Diagnosis and fault-code read');
    expect(cell(shown[0], 'state')).toBe('on the profile');
    expect(cell(shown[3], 'duration')).toBe('1 day');
    expect(cell(shown[5], 'state')).toBe('hidden · no top price set');
    expect(cell(shown[5], 'price')).toBe('from 350 lei');
    expect(text(element.querySelector('[data-labour]'))).toBe(
      'Labour: 180–240 lei / hour. The low end is the small, easy car; the high end is the big or awkward one.',
    );
  });

  it('names each reason in both languages, every hidden row amber', async () => {
    const reasons = [
      ['rejected', 'respins', 'rejected'],
      [
        'awaiting_approval',
        'ascuns · așteaptă aprobarea',
        'hidden · awaiting approval',
      ],
      [
        'not_authorised',
        'ascuns · nu e în autorizația RAR',
        'hidden · not in your RAR authorisation',
      ],
      ['hidden_by_garage', 'ascuns de tine', 'hidden by you'],
      ['no_top_price', 'ascuns · fără preț maxim', 'hidden · no top price set'],
    ] as const;
    const answer = async () => ({
      items: reasons.map(([reason]) =>
        item({ jobTypeId: reason, public: false, reason }),
      ),
    });
    const romanian = await render(answer);
    await romanian.settle();
    expect(rows(romanian.element).map((row) => cell(row, 'state'))).toEqual(
      reasons.map(([, ro]) => ro),
    );
    expect(rows(romanian.element).map((row) => row.dataset['public'])).toEqual(
      Array(5).fill('false'),
    );
    TestBed.resetTestingModule();

    const english = await render(answer, 'en');
    await english.settle();
    expect(rows(english.element).map((row) => cell(row, 'state'))).toEqual(
      reasons.map(([, , en]) => en),
    );
  });

  it('rounds a price in bani to whole lei', async () => {
    const { element, settle } = await render(async () => ({
      items: [item({ fromBani: 15_049, toBani: 22_051 })],
    }));
    await settle();

    expect(cell(rows(element)[0], 'price')).toBe('150–221 lei');
  });

  it('gives the hourly labour range under the list, and nothing when the read has none', async () => {
    const withLabour = await render();
    await withLabour.settle();
    expect(text(withLabour.element.querySelector('[data-labour]'))).toBe(
      'Manoperă: 180–240 lei / oră. Minimul e mașina mică și simplă, maximul e cea mare sau dificilă.',
    );
    TestBed.resetTestingModule();

    const without = await render(async () => ({ items: SEEDED }));
    await without.settle();
    expect(without.element.querySelector('[data-labour]')).toBeNull();
    expect(rows(without.element)).toHaveLength(6);
  });

  it('has no button and no row action', async () => {
    const { element, settle } = await render();
    await settle();

    expect(element.querySelectorAll('button, a')).toHaveLength(0);
  });
});

// @traces 172-FR-002 172-FR-003
describe('Prețuri: a row the read gives oddly', () => {
  it('reads a hidden job with no or an unknown reason as hidden, a stray reason on a public one as on the profile, and no range as the missing mark', async () => {
    const { element, settle } = await render(
      async () => ({
        items: [
          item({ jobTypeId: 'a', public: false, reason: undefined }),
          item({
            jobTypeId: 'b',
            public: false,
            reason: 'frozen' as unknown as 'rejected',
          }),
          item({ jobTypeId: 'c', reason: 'rejected' }),
          item({
            durationMinutes: undefined,
            fromBani: undefined,
            jobTypeId: 'd',
            nameEn: '   ',
            nameRo: '<img src=x> Lucrare ț',
            toBani: undefined,
          }),
        ],
      }),
      'en',
    );
    await settle();

    const shown = rows(element);
    expect(shown.map((row) => cell(row, 'state'))).toEqual([
      'hidden',
      'hidden',
      'on the profile',
      'on the profile',
    ]);
    expect(shown.map((row) => row.dataset['public'])).toEqual([
      'false',
      'false',
      'true',
      'true',
    ]);
    expect(cell(shown[3], 'price')).toBe('—');
    expect(cell(shown[3], 'name')).toBe('<img src=x> Lucrare ț');
    expect(element.querySelector('img')).toBeNull();
    expect(shown[3].querySelector('[data-duration]')).toBeNull();
  });
});

// @traces 172-FR-004
describe('Prețuri: brand ranges under their job', () => {
  it('lists a job’s brand ranges under its row, in the read’s order, and none under a job without', async () => {
    const { element, settle } = await render(async () => ({
      items: [
        item({
          brandRanges: [
            { brandId: 'bmw', fromBani: 110_000, name: 'BMW', toBani: 170_000 },
            { brandId: 'audi', fromBani: 120_000, name: 'Audi' },
          ],
        }),
        item({ jobTypeId: 'oil' }),
      ],
    }));
    await settle();

    const [brakes, oil] = rows(element);
    expect(brandLines(brakes)).toEqual([
      'BMW · 1.100–1.700 lei',
      'Audi · de la 1.200 lei',
    ]);
    expect(brandLines(oil)).toEqual([]);
  });

  it('keeps the brand’s catalogue name in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    expect(brandLines(rows(element)[2])).toEqual(['BMW · 1,100–1,700 lei']);
  });
});

// @traces 172-FR-007 172-FR-008
describe('Prețuri: live, loading, failure and an empty list', () => {
  it('shows busy skeleton rows with no text while the first read runs', async () => {
    let finish: (() => void) | undefined;
    const { element, settle } = await render(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ items: SEEDED });
        }),
    );
    await settle();

    const panel = element.querySelector('section.panel');
    expect(text(panel?.querySelector('h2') ?? null)).toBe('Lista de prețuri');
    expect(panel?.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(panel?.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(
      0,
    );
    expect(text(panel?.querySelector('[aria-busy="true"]') ?? null)).toBe('');
    expect(text(element)).toBe('Lista de prețuri');
    expect(rows(element)).toHaveLength(0);
    finish?.();
    await settle();
    expect(rows(element)).toHaveLength(6);
    expect(element.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('says the read failed and reads again on Încearcă din nou', async () => {
    let fail = true;
    const { element, settle } = await render(async () => {
      if (fail) throw new HttpErrorResponse({ status: 500 });
      return { items: SEEDED };
    });
    await settle();

    const panel = element.querySelector('section.panel');
    expect(text(panel?.querySelector('h2') ?? null)).toBe('Lista de prețuri');
    expect(panel?.querySelector('[role="alert"]')).not.toBeNull();
    const retry = panel?.querySelector('button') as HTMLButtonElement;
    expect(text(retry)).toBe('Încearcă din nou');
    fail = false;
    retry.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(rows(element)).toHaveLength(6);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('says the list is empty, with no row, note or action', async () => {
    const { element, settle } = await render(async () => ({
      items: [],
      labour: LABOUR,
    }));
    await settle();

    const panel = element.querySelector('section.panel');
    expect(text(panel?.querySelector('h2') ?? null)).toBe('Lista de prețuri');
    expect(text(panel?.querySelector('p') ?? null)).toBe(
      'Nu ai încă lucrări în listă.',
    );
    expect(panel?.children).toHaveLength(2);
    expect(rows(element)).toHaveLength(0);
    expect(element.querySelector('[data-labour]')).toBeNull();
    expect(element.querySelector('button')).toBeNull();
  });

  it('never says the list is empty when the garage is gone', async () => {
    const { element, settle } = await render(async () => {
      throw new HttpErrorResponse({ status: 404 });
    });
    await settle();

    expect(text(element)).not.toContain('Nu ai încă lucrări în listă.');
    expect(rows(element)).toHaveLength(0);
  });

  it("reads again on its garage's price list change and a catalogue decision, a burst as one read, and not on another garage's change", async () => {
    const { element, settle } = await render();
    await settle();
    expect(read).toHaveBeenCalledTimes(1);

    events.next(message('price_list.updated', 'another-garage'));
    await wait(350);
    await settle();
    expect(read).toHaveBeenCalledTimes(1);

    events.next(message('price_list.updated', GARAGE));
    events.next(message('price_list.updated', GARAGE));
    await wait(350);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);

    events.next(message('catalogue_job.decided', 'job-type-1'));
    await wait(350);
    await settle();
    expect(read).toHaveBeenCalledTimes(3);
    expect(rows(element)).toHaveLength(6);
  });

  it('reads again on a resync', async () => {
    const { settle } = await render();
    await settle();

    resync.next();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps the rows shown when a re-read fails', async () => {
    let fail = false;
    const { element, settle } = await render(async () => {
      if (fail) throw new HttpErrorResponse({ status: 500 });
      return { items: SEEDED };
    });
    await settle();
    fail = true;

    resync.next();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(rows(element)).toHaveLength(6);
  });
});
