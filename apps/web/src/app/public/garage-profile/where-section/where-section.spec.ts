import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { WhereSection } from './where-section';

const OPEN = [['08:00', '19:00']];
const HOURS = {
  fri: OPEN,
  mon: OPEN,
  sat: [['09:00', '14:00']],
  sun: [],
  thu: OPEN,
  tue: OPEN,
  wed: OPEN,
};
const ADDRESS = 'Str. Atelierului 14, Militari, Sector 6, București';

const GARAGE: PublicGarageDto = {
  address: ADDRESS,
  brandNote: null,
  businessKind: 'company',
  doesNotTake: [],
  facilities: [],
  hours: HOURS,
  id: 'g-1',
  jobTypes: [],
  name: 'Atelier Dinamo',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'atelier-dinamo',
  verifiedAt: null,
  worksOn: [],
};

const MOBILE: PublicGarageDto = {
  ...GARAGE,
  address: undefined,
  businessKind: 'mobile',
  serviceRadiusKm: 35,
};

@Component({
  imports: [WhereSection],
  template: `<section
    data-slot="where"
    mf-where-section
    [garage]="garage()"
  ></section>`,
})
class Host {
  readonly garage = signal(GARAGE);
}

let fixture: ComponentFixture<Host>;

beforeEach(async () => {
  TestBed.configureTestingModule({});
  await TestBed.inject(I18n).enter('public');
  await TestBed.inject(I18n).use('ro');
  fixture = TestBed.createComponent(Host);
  await settle();
});

afterEach(() => fixture.destroy());

async function settle() {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function show(garage: Partial<PublicGarageDto>) {
  fixture.componentInstance.garage.set({ ...GARAGE, ...garage });
  await settle();
}

async function english() {
  await TestBed.inject(I18n).use('en');
  await settle();
}

const section = () =>
  fixture.nativeElement.querySelector('section') as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = () =>
  [...section().querySelectorAll('.row')].map((row) => [
    text(row.querySelector('.days')),
    text(row.querySelector('.times')),
  ]);

// @traces 308-FR-011
// @traces 308-FR-012
// @traces 308-FR-015
describe('where a workshop is and when it is open', () => {
  it('is titled Unde and shows the address as one text, then the hours', () => {
    expect(text(section().querySelector('h2'))).toBe('Unde');
    expect(text(section().querySelector('.address'))).toBe(ADDRESS);
    expect(rows()).toEqual([
      ['Luni – vineri', '08:00 – 19:00'],
      ['Sâmbătă', '09:00 – 14:00'],
      ['Duminică', 'Închis'],
    ]);
    expect(section().hidden).toBe(false);
  });

  it('says it in English, the address as the garage wrote it', async () => {
    await english();

    expect(text(section().querySelector('h2'))).toBe('Where');
    expect(text(section().querySelector('.address'))).toBe(ADDRESS);
    expect(rows()).toEqual([
      ['Monday – Friday', '08:00 – 19:00'],
      ['Saturday', '09:00 – 14:00'],
      ['Sunday', 'Closed'],
    ]);
  });

  it('marks a closed day so it can stand apart', () => {
    const closed = section().querySelectorAll('.times.closed');

    expect([...closed].map((el) => text(el))).toEqual(['Închis']);
  });

  it('shows the address and no hours line when the hours were never sent', async () => {
    await show({ hours: {} });

    expect(text(section().querySelector('.address'))).toBe(ADDRESS);
    expect(rows()).toEqual([]);
  });

  it('shows nothing when it has neither an address nor hours', async () => {
    await show({ address: undefined, hours: {} });

    expect(section().hidden).toBe(true);
    expect(text(section())).toBe('');
  });
});

// @traces 308-FR-011
// @traces 308-FR-015
describe('where a mobile mechanic works', () => {
  it('says it comes to the driver within its radius, with no address', async () => {
    await show(MOBILE);

    expect(text(section().querySelector('.area'))).toBe(
      'Vine la tine în zona de 35 km',
    );
    expect(section().querySelector('.address')).toBeNull();
    expect(rows()).toEqual([
      ['Luni – vineri', '08:00 – 19:00'],
      ['Sâmbătă', '09:00 – 14:00'],
      ['Duminică', 'Închis'],
    ]);
  });

  it('says 20 km when the answer carries no radius', async () => {
    await show({ ...MOBILE, serviceRadiusKm: undefined });

    expect(text(section().querySelector('.area'))).toBe(
      'Vine la tine în zona de 20 km',
    );
  });

  it('never falls back to an address, even one the answer carried', async () => {
    await show({ ...MOBILE, address: ADDRESS });

    expect(section().querySelector('.address')).toBeNull();
    expect(text(section())).not.toContain('Atelierului');
  });

  it('says it in English', async () => {
    await show(MOBILE);
    await english();

    expect(text(section().querySelector('.area'))).toBe(
      'Comes to you within 35 km',
    );
  });
});
