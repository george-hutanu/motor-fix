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

const GARAGE = {
  brandNote: null,
  doesNotTake: [],
  id: 'g-1',
  jobTypes: [],
  name: 'Service Auto Militari',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [
    {
      fromBani: 15_000,
      jobTypeId: 'j-diag',
      nameEn: 'Diagnosis',
      nameRo: 'Diagnoză',
      toBani: 22_000,
    },
  ],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [],
} as PublicGarageDto;

let open: jest.Mock;

async function render() {
  open = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      PriceSelection,
      {
        provide: OVERLAY_TASK,
        useFactory: () => ({
          close: jest.fn(),
          data: { garage: signal(GARAGE), selection: inject(PriceSelection) },
          focusStart: jest.fn(),
          markUnchanged: jest.fn(),
        }),
      },
      { provide: Overlays, useValue: { open } },
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
  await TestBed.inject(I18n).use('ro');
  sessionStorage.clear();
  const selection = TestBed.inject(PriceSelection);
  selection.sync(GARAGE);
  selection.toggle('j-diag', true);
  const fixture = TestBed.createComponent(EstimateSheet);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, fixture, selection };
}

afterEach(() => TestBed.resetTestingModule());

// @traces 311-FR-005
describe('the estimate sheet', () => {
  it('shows the page’s own selection, not a fresh empty one', async () => {
    const { el, fixture, selection } = await render();

    expect(fixture.debugElement.injector.get(PriceSelection)).toBe(selection);
    expect(el.querySelector('.row .name')?.textContent?.trim()).toBe(
      'Diagnoză',
    );
  });

  it('renders the box with the sheet class', async () => {
    const { el } = await render();

    expect(
      el.querySelector('section[mf-estimate-section]')?.classList,
    ).toContain('sheet');
  });

  it('follows a switch made on the page while it is open', async () => {
    const { el, fixture, selection } = await render();
    selection.toggle('j-diag', false);
    fixture.detectChanges();

    expect(el.querySelector('.row')).toBeNull();
  });
});
