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

const LIST: PriceListItemDto[] = [
  item(),
  item({ jobTypeId: 'oil', nameRo: 'Schimb de ulei și filtre' }),
  item({
    jobTypeId: 'suspension',
    nameRo: 'Verificare suspensie și geometrie',
    public: false,
    reason: 'no_top_price',
    toBani: undefined,
  }),
  item({
    jobTypeId: 'chain',
    nameRo: 'Kit lanț de distribuție',
    public: false,
    reason: 'hidden_by_garage',
    visible: false,
  }),
];

const me = {
  garageAccess: [{ garageId: GARAGE, role: 'owner' }],
  garageId: GARAGE,
} as unknown as MeDto;

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let read: jest.Mock;
let setRange: jest.Mock;

const text = (element: Element | null) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-row]'),
];
const state = (row: HTMLElement) => text(row.querySelector('[data-state]'));
const action = (row: HTMLElement, name: string) =>
  [...row.querySelectorAll('button')].find(
    (b) => text(b) === name,
  ) as HTMLButtonElement;

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

async function editing(answer: () => Promise<PriceListDto>) {
  events = new Subject();
  resync = new Subject();
  read = jest.fn(answer);
  setRange = jest.fn(async () => ({}));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: {
          priceListControllerRead: read,
          priceListControllerSetRange: setRange,
        },
      },
      { provide: Session, useValue: { shown: signal(me) } },
      { provide: Overlays, useValue: { open: jest.fn() } },
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
  [...element.querySelectorAll('button')]
    .find((b) => text(b) === 'Modifică prețurile')
    ?.click();
  await settle();
  return { element, settle };
}

afterEach(() => TestBed.resetTestingModule());

// @traces 1315-FR-006
// @traces 1315-FR-007
// @traces 1315-FR-008
describe('Prețuri: hide and show under odd answers', () => {
  it('sends visible true and shows the row on the profile before Arată answers', async () => {
    const { element, settle } = await editing(async () => ({ items: LIST }));
    const pending = deferred<object>();
    setRange.mockImplementationOnce(() => pending.promise);

    action(rows(element)[3], 'Arată').click();
    await settle();

    expect(setRange).toHaveBeenCalledWith({
      body: { visible: true },
      garageId: GARAGE,
      priceId: 'price-chain',
    });
    expect(state(rows(element)[3])).toBe('pe profil');
    expect(rows(element)[3].getAttribute('aria-busy')).toBe('true');
    for (const b of rows(element)[3].querySelectorAll('button'))
      expect(b.disabled).toBe(true);
  });

  it('shows the server reason after Arată when another rule keeps the job hidden', async () => {
    const { element, settle } = await editing(async () => ({ items: LIST }));
    read.mockResolvedValueOnce({
      items: [
        ...LIST.slice(0, 3),
        item({
          jobTypeId: 'chain',
          nameRo: 'Kit lanț de distribuție',
          public: false,
          reason: 'no_top_price',
          visible: true,
        }),
      ],
    });

    action(rows(element)[3], 'Arată').click();
    await settle();

    expect(state(rows(element)[3])).toContain('fără preț maxim');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('puts back the reason a row had, not a generic one, when Ascunde is refused', async () => {
    const { element, settle } = await editing(async () => ({ items: LIST }));
    const before = state(rows(element)[2]);
    expect(before).toContain('fără preț maxim');
    const pending = deferred<object>();
    setRange.mockImplementationOnce(() => pending.promise);

    action(rows(element)[2], 'Ascunde').click();
    await settle();
    expect(state(rows(element)[2])).toBe('ascuns de tine');
    pending.reject(new HttpErrorResponse({ status: 403 }));
    await settle();

    expect(state(rows(element)[2])).toBe(before);
    expect(rows(element)[2].querySelector('[role="alert"]')).not.toBeNull();
  });

  it('rolls back and enables the buttons when the save fails with a plain error', async () => {
    const { element, settle } = await editing(async () => ({ items: LIST }));
    setRange.mockRejectedValueOnce(new Error('network down'));

    action(rows(element)[0], 'Ascunde').click();
    await settle();

    const row = rows(element)[0];
    expect(state(row)).toBe('pe profil');
    expect(row.getAttribute('aria-busy')).toBeNull();
    for (const b of row.querySelectorAll('button'))
      expect(b.disabled).toBe(false);
    expect(text(row.querySelector('[role="alert"]'))).toBe(
      'Nu s‑a salvat. Încearcă din nou.',
    );
  });

  it('leaves the other rows untouched while one flip is out and after it fails', async () => {
    const { element, settle } = await editing(async () => ({ items: LIST }));
    const others = () =>
      rows(element)
        .slice(1)
        .map((r) => state(r));
    const before = others();
    setRange.mockRejectedValueOnce(new Error('refused'));

    action(rows(element)[0], 'Ascunde').click();
    await settle();

    expect(others()).toEqual(before);
    expect(setRange).toHaveBeenCalledTimes(1);
  });

  it('sends a fresh write only on a second press after a refusal, never by itself', async () => {
    const { element, settle } = await editing(async () => ({ items: LIST }));
    setRange.mockRejectedValueOnce(new Error('refused'));

    action(rows(element)[0], 'Ascunde').click();
    await settle();
    await settle();
    expect(setRange).toHaveBeenCalledTimes(1);
    action(rows(element)[0], 'Ascunde').click();
    await settle();

    expect(setRange).toHaveBeenCalledTimes(2);
  });

  it('ignores a second press on the row while the first is out', async () => {
    const { element, settle } = await editing(async () => ({ items: LIST }));
    const pending = deferred<object>();
    setRange.mockImplementationOnce(() => pending.promise);
    const button = action(rows(element)[0], 'Ascunde');

    button.click();
    button.click();
    await settle();

    expect(setRange).toHaveBeenCalledTimes(1);
  });

  it('keeps the optimistic state when the re-read after a good save fails', async () => {
    const { element, settle } = await editing(async () => ({ items: LIST }));
    read.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));

    action(rows(element)[0], 'Ascunde').click();
    await settle();

    expect(state(rows(element)[0])).toBe('ascuns de tine');
    expect(rows(element)[0].querySelector('[role="alert"]')).toBeNull();
  });

  it('writes one call per press when two different rows are flipped back to back', async () => {
    const { element, settle } = await editing(async () => ({ items: LIST }));
    const first = deferred<object>();
    const second = deferred<object>();
    setRange
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    action(rows(element)[0], 'Ascunde').click();
    await settle();
    action(rows(element)[1], 'Ascunde').click();
    await settle();
    first.reject(new Error('refused'));
    await settle();

    expect(setRange).toHaveBeenCalledTimes(2);
    expect(state(rows(element)[0])).toBe('pe profil');
    expect(state(rows(element)[1])).toBe('ascuns de tine');
  });
});
