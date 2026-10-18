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
import { Overlays } from '@motor-fix/overlays';
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
  priceId: `price-${over.jobTypeId ?? 'diagnosis'}`,
  public: true,
  toBani: 22_000,
  updatedAt: '2026-10-18T09:00:00.000Z',
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
let open: jest.Mock;

async function render(
  answer: () => Promise<PriceListDto> = async () => ({
    items: SEEDED,
    labour: LABOUR,
  }),
  language: 'ro' | 'en' = 'ro',
  session: MeDto = me,
) {
  events = new Subject();
  resync = new Subject();
  read = jest.fn(answer);
  open = jest.fn(async () => 'saved');
  TestBed.configureTestingModule({
    providers: [
      { provide: GaragesService, useValue: { priceListControllerRead: read } },
      { provide: Session, useValue: { shown: signal(session) } },
      { provide: Overlays, useValue: { open } },
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
const _cell = (row: HTMLElement, name: string) =>
  text(row.querySelector(`[data-${name}]`));
const _brandLines = (row: HTMLElement) =>
  [...row.querySelectorAll('[data-brand]')].map(text);
const message = (kind: string, id: string): LiveMessage => ({
  at: '2026-10-18T09:00:00.000Z',
  id,
  kind,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => TestBed.resetTestingModule());

const buttons = (root: Element) => [...root.querySelectorAll('button')];
const named = (root: Element, name: string) =>
  buttons(root).find((b) => text(b) === name) as HTMLButtonElement;
const editButtons = (root: Element) =>
  buttons(root).filter((b) => text(b) === 'Modifică');

const editingOn = async (
  answer?: () => Promise<PriceListDto>,
  language: 'ro' | 'en' = 'ro',
) => {
  const view = await render(answer, language);
  await view.settle();
  named(
    view.element,
    language === 'en' ? 'Edit prices' : 'Modifică prețurile',
  ).click();
  await view.settle();
  return view;
};

// @traces 173-FR-001
// @traces 173-FR-002
describe('Prețuri: the editing switch under odd lists', () => {
  it('does not open an editor for a job that has no default row', async () => {
    const { element, settle } = await editingOn(async () => ({
      items: [
        item({
          brandRanges: [
            { brandId: 'bmw', fromBani: 1_000, name: 'BMW', toBani: 2_000 },
          ],
          fromBani: undefined,
          priceId: undefined,
          toBani: undefined,
          updatedAt: undefined,
        }),
      ],
    }));

    const rowButtons = [
      ...rows(element)[0].querySelectorAll(':scope > .line button'),
    ] as HTMLButtonElement[];
    for (const b of rowButtons) b.click();
    await settle();

    for (const [, options] of open.mock.calls) {
      expect(options.data.item?.priceId).toBeTruthy();
    }
  });

  it('opens one editor when a row action is pressed twice at once', async () => {
    const { element, settle } = await editingOn();
    open.mockImplementation(() => new Promise(() => undefined));
    const action = rows(element)[0].querySelector(
      'button',
    ) as HTMLButtonElement;

    action.click();
    action.click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('hands the next editor the row as the last read gave it', async () => {
    const newer = item({
      fromBani: 16_000,
      priceId: 'p-1',
      updatedAt: '2026-10-18T10:00:00.000Z',
    });
    let reads = 0;
    const { element, settle } = await editingOn(async () => {
      reads += 1;
      return {
        items: [
          reads === 1
            ? item({ priceId: 'p-1', updatedAt: '2026-10-18T09:00:00.000Z' })
            : newer,
        ],
      };
    });

    (rows(element)[0].querySelector('button') as HTMLButtonElement).click();
    await settle();
    (rows(element)[0].querySelector('button') as HTMLButtonElement).click();
    await settle();

    expect(open.mock.calls[1][1].data.item).toEqual(newer);
  });

  it('keeps editing on and the actions shown across a live re-read', async () => {
    const { element, settle } = await editingOn();

    events.next(message('price_list.updated', GARAGE));
    await wait(1_200);
    await settle();

    expect(editButtons(element)).toHaveLength(8);
    expect(text(named(element, 'Gata'))).toBe('Gata');
  });

  it('drops the actions when the same session turns out not to be the owner', async () => {
    const shown = signal<MeDto>(me);
    events = new Subject();
    resync = new Subject();
    read = jest.fn(async () => ({ items: SEEDED, labour: LABOUR }));
    open = jest.fn(async () => 'saved');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: GaragesService,
          useValue: { priceListControllerRead: read },
        },
        { provide: Session, useValue: { shown } },
        { provide: Overlays, useValue: { open } },
        {
          provide: Live,
          useValue: { events, on: () => events, resync },
        },
      ],
    });
    await TestBed.inject(I18n).enter('garage');
    const fixture = TestBed.createComponent(PricesView);
    const element = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      for (let i = 0; i < 4; i++) {
        fixture.detectChanges();
        await fixture.whenStable();
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    await settle();
    named(element, 'Modifică prețurile').click();
    await settle();
    expect(editButtons(element)).toHaveLength(8);

    shown.set({
      garageAccess: [{ garageId: GARAGE, role: 'mechanic' }],
      garageId: GARAGE,
    } as unknown as MeDto);
    await settle();

    expect(buttons(element)).toHaveLength(0);
  });

  it('shows no switch while the first read has failed', async () => {
    const { element, settle } = await render(async () => {
      throw new HttpErrorResponse({ status: 500 });
    });
    await settle();

    expect(buttons(element).map(text)).not.toContain('Modifică prețurile');
  });

  it('names the English editor for a job by its English name', async () => {
    const { element, settle } = await editingOn(undefined, 'en');

    (rows(element)[2].querySelector('button') as HTMLButtonElement).click();
    await settle();

    expect(open.mock.calls[0][1].title).toBe('Front brake pads and discs');
  });
});
