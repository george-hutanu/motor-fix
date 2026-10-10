import { TestBed } from '@angular/core/testing';
import type { HomeGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { garageWhere } from './where';

const garageOf = (over: Partial<HomeGarageDto> = {}): HomeGarageDto => ({
  businessKind: 'company',
  city: 'București',
  distanceKm: 2.4,
  doesNotTake: [],
  id: 'militari',
  labourFromLei: 180,
  name: 'Service Auto Militari',
  rating: 4.9,
  reviewCount: 212,
  slug: 'service-auto-militari',
  stance: 'works_on',
  worksOn: ['BMW'],
  ...over,
});

let i18n: I18n;

beforeEach(async () => {
  i18n = TestBed.inject(I18n);
  await i18n.enter('public');
});

describe('garageWhere', () => {
  it('keeps the city as written and says the distance after a dot', () => {
    expect(garageWhere(garageOf(), i18n)).toEqual({
      city: 'București',
      rest: ' · 2,4 km',
    });
  });

  it('keeps the city as written on /en too', async () => {
    await i18n.use('en');
    expect(garageWhere(garageOf(), i18n)?.city).toBe('București');
  });

  it('says only the city when the distance is unknown', () => {
    expect(garageWhere(garageOf({ distanceKm: undefined }), i18n)).toEqual({
      city: 'București',
      rest: '',
    });
  });

  it('says only the distance when the city is unknown', () => {
    expect(garageWhere(garageOf({ city: undefined }), i18n)).toEqual({
      city: '',
      rest: '2,4 km',
    });
  });

  it('is nothing when neither is known', () => {
    expect(
      garageWhere(garageOf({ city: undefined, distanceKm: undefined }), i18n),
    ).toBeNull();
  });

  it('says a mobile mechanic comes to you, and its area only when asked', () => {
    const mobile = garageOf({
      businessKind: 'mobile',
      serviceRadiusKm: 15,
    });
    const plain = garageWhere(mobile, i18n);
    expect(plain?.city).toBe('');
    expect(plain?.rest).toBe(i18n.t('public.home.dial.mobile'));
    expect(garageWhere(mobile, i18n, { area: true })?.rest).toBe(
      `${i18n.t('public.home.dial.mobile')} · ${i18n.t('public.home.cards.area', { km: 15 })}`,
    );
    expect(
      garageWhere(garageOf({ businessKind: 'mobile' }), i18n, { area: true })
        ?.rest,
    ).toBe(i18n.t('public.home.dial.mobile'));
  });
});
