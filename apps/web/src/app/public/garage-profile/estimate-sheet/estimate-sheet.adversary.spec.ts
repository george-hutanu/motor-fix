import { inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { OVERLAY_TASK, Overlays } from '@motor-fix/overlays';

import { EstimateSheet } from './estimate-sheet';
import { Consent } from '../../../consent/consent';
import { Session } from '../../../dashboard/session';
import { PriceSelection } from '../price-selection/price-selection';

const price = (id: string, from: number, to: number) => ({
  fromBani: from,
  jobTypeId: id,
  nameEn: `${id} en`,
  nameRo: `${id} ro`,
  toBani: to,
});

const GARAGE = {
  brandNote: null,
  doesNotTake: [],
  id: 'g-1',
  jobTypes: [],
  name: 'Service Auto Militari',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [price('a', 15_000, 22_000), price('b', 110_000, 170_000)],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [],
} as PublicGarageDto;

async function render(language: 'ro' | 'en' = 'ro') {
  const garage = signal(GARAGE);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      PriceSelection,
      {
        provide: OVERLAY_TASK,
        useFactory: () => ({
          close: jest.fn(),
          data: { garage, selection: inject(PriceSelection) },
          focusStart: jest.fn(),
          markUnchanged: jest.fn(),
        }),
      },
      { provide: Overlays, useValue: { open: jest.fn(async () => undefined) } },
      { provide: Consent, useValue: { track: jest.fn() } },
      {
        provide: Session,
        useValue: {
          current: signal(null),
          load: jest.fn(async () => null),
          renew: jest.fn(async () => true),
          roleHint: signal(null),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
      },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  await TestBed.inject(I18n).use(language);
  sessionStorage.clear();
  const selection = TestBed.inject(PriceSelection);
  selection.sync(GARAGE);
  const fixture = TestBed.createComponent(EstimateSheet);
  fixture.detectChanges();
  return {
    el: fixture.nativeElement as HTMLElement,
    fixture,
    garage,
    selection,
  };
}

afterEach(() => TestBed.resetTestingModule());

// @traces 311-FR-005
describe('the estimate sheet under odd states', () => {
  it('shows the empty text with nothing on', async () => {
    const { el } = await render();

    expect(el.textContent).toContain(
      'Pornește lucrările de care ai nevoie în lista de prețuri și contorul le adună.',
    );
    expect(el.querySelector('.row')).toBeNull();
  });

  it('shows the empty text in English', async () => {
    const { el } = await render('en');

    expect(el.textContent).toContain(
      'Switch on the jobs you need in the price list and the counter adds them up.',
    );
  });

  it('lists both rows in the list’s order and sums them', async () => {
    const { el, fixture, selection } = await render();
    selection.toggle('b', true);
    selection.toggle('a', true);
    fixture.detectChanges();

    expect(
      [...el.querySelectorAll('.row .name')].map((n) => n.textContent?.trim()),
    ).toEqual(['a ro', 'b ro']);
    expect(el.textContent).toContain('Estimare de la 1.250 la 1.920 lei');
  });

  it('follows the garage signal when the prices shrink', async () => {
    const { el, fixture, garage, selection } = await render();
    selection.toggle('a', true);
    selection.toggle('b', true);
    const next = { ...GARAGE, prices: [GARAGE.prices[1]] };
    selection.sync(next);
    garage.set(next);
    fixture.detectChanges();

    expect(
      [...el.querySelectorAll('.row .name')].map((n) => n.textContent?.trim()),
    ).toEqual(['b ro']);
  });

  it('keeps its selection when a second sheet is built over the same one', async () => {
    const { selection } = await render();
    selection.toggle('a', true);
    const again = TestBed.createComponent(EstimateSheet);
    again.detectChanges();

    expect(again.debugElement.injector.get(PriceSelection)).toBe(selection);
    expect([...selection.on()]).toEqual(['a']);
  });
});
