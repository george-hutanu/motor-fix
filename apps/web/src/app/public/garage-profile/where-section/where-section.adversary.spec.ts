import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GARAGE_MAP } from './garage-map/garage-map';
import { WhereSection } from './where-section';
import { Consent } from '../../../consent/consent';

const OPEN = [['08:00', '19:00']];
const GARAGE: PublicGarageDto = {
  address: 'Str. Atelierului 14, București',
  brandNote: null,
  businessKind: 'company',
  closedDays: [],
  doesNotTake: [],
  facilities: [],
  hours: {
    fri: OPEN,
    mon: OPEN,
    sat: [],
    sun: [],
    thu: OPEN,
    tue: OPEN,
    wed: OPEN,
  },
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
  TestBed.configureTestingModule({
    providers: [
      { provide: Consent, useValue: { track: jest.fn() } },
      { provide: GARAGE_MAP, useValue: jest.fn() },
    ],
  });
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

const section = () =>
  fixture.nativeElement.querySelector('section') as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// @traces 308-FR-011
describe('where a garage is, under odd answers', () => {
  it('shows an address holding markup as plain text', async () => {
    const address = 'Str. <b>Școlii</b> 3 <img src=x onerror=alert(1)>';
    await show({ address });

    expect(text(section().querySelector('.address'))).toBe(address);
    expect(section().querySelector('.address *')).toBeNull();
    expect(section().querySelector('img')).toBeNull();
  });

  it('says 20 km for a mobile mechanic whose radius came as null', async () => {
    await show({
      address: undefined,
      businessKind: 'mobile',
      serviceRadiusKm: null as unknown as undefined,
    });

    expect(text(section())).toContain('Vine la tine în zona de 20 km');
  });

  it('shows a mobile mechanic no hours line and no address text, whatever was sent', async () => {
    await show({ businessKind: 'mobile', serviceRadiusKm: 35 });

    expect(text(section())).not.toContain('Str. Atelierului');
    expect(text(section())).toContain('Vine la tine în zona de 35 km');
    expect(section().querySelector('a, button, img, iframe')).toBeNull();
  });
});

// @traces 308-FR-014
describe('where a garage is, when the answer is read again', () => {
  it('swaps the address and hours in place, in the same section element', async () => {
    const before = section();

    await show({
      address: 'Bd. Nou 1, Cluj',
      hours: { ...GARAGE.hours, mon: [['10:00', '11:00']] },
    });

    expect(section()).toBe(before);
    expect(text(section().querySelector('.address'))).toBe('Bd. Nou 1, Cluj');
    expect(text(section().querySelector('.row'))).toBe('Luni10:00 – 11:00');
  });

  it('drops the hours lines when the new answer carries an empty table', async () => {
    await show({ hours: {} });

    expect(section().querySelectorAll('.row').length).toBe(0);
    expect(text(section().querySelector('.address'))).toBe(
      'Str. Atelierului 14, București',
    );
  });
});

// @traces 1366-FR-007
describe('where a garage is, on a map, under odd answers', () => {
  const link = () => section().querySelector('a.directions');

  it('shows a mobile mechanic that carries a point no map and no directions', async () => {
    await show({
      address: undefined,
      businessKind: 'mobile',
      latitude: 44.43,
      longitude: 26.1,
      serviceRadiusKm: 35,
    });

    expect(section().querySelector('mf-garage-map')).toBeNull();
    expect(link()).toBeNull();
  });

  it('treats a null coordinate as none', async () => {
    await show({
      latitude: null as unknown as undefined,
      longitude: 26.1,
    });

    expect(section().querySelector('mf-garage-map')).toBeNull();
    expect(link()).toBeNull();
  });

  it('keeps a point at zero degrees, a real number, in the address', async () => {
    await show({ latitude: 44.5, longitude: 0 });

    expect(link()?.getAttribute('href')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=44.5,0',
    );
  });

  it('writes a long coordinate in full, never rounded, with no NaN or undefined', async () => {
    await show({ latitude: 44.123456789, longitude: 26.987654321 });
    const href = link()?.getAttribute('href') ?? '';

    expect(href).toContain('44.123456789,26.987654321');
    expect(href).not.toMatch(/NaN|undefined|null/);
  });

  it('writes the coordinates with a dot in English too', async () => {
    await show({ latitude: 44.43, longitude: 26.1 });
    await TestBed.inject(I18n).use('en');
    await settle();

    expect(link()?.getAttribute('href')).toContain('44.43,26.1');
  });
});
