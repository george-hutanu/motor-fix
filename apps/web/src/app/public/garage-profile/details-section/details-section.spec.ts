import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { DetailsSection } from './details-section';

type Fuel = 'petrol' | 'diesel' | 'hybrid' | 'electric';
const ALL: Fuel[] = ['petrol', 'diesel', 'hybrid', 'electric'];
const taken = (name: string, fuels: Fuel[] = ALL) => ({
  fuels,
  id: `b-${name}`,
  name,
  slug: name.toLowerCase(),
});
const refused = (name: string) => ({
  id: `b-${name}`,
  name,
  slug: name.toLowerCase(),
});

const NOTE = 'Fără mașini 100% electrice și nimic fabricat înainte de 2005.';
const FACILITIES_NOTE = 'Cafea și wifi în sala de așteptare.';

const GARAGE: PublicGarageDto = {
  brandNote: NOTE,
  doesNotTake: ['Dacia', 'Toyota', 'Ford', 'Tesla'].map(refused),
  facilities: [],
  hours: {},
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
  worksOn: [
    taken('BMW', ['petrol', 'diesel', 'hybrid']),
    taken('Mini'),
    taken('Mercedes-Benz'),
    taken('Audi'),
    taken('Volkswagen'),
    taken('Škoda'),
  ],
};

@Component({
  imports: [DetailsSection],
  template: `<section
    data-slot="brands"
    mf-details-section
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
const group = (name: 'works' | 'refuses' | 'facilities') =>
  section().querySelector(`.group.${name}`);
const chips = (name: 'works' | 'refuses') =>
  [...(group(name)?.querySelectorAll('li') ?? [])].map((li) => ({
    fuels: text(li.querySelector('.fuels')),
    lamp: li.querySelector('mf-lamp')?.getAttribute('data-state'),
    name: text(li.querySelector('mf-lamp')),
  }));
const facilities = () =>
  [...(group('facilities')?.querySelectorAll('li') ?? [])].map((li) =>
    text(li),
  );

// @traces 308-FR-004
// @traces 308-FR-005
// @traces 308-FR-006
// @traces 308-FR-007
// @traces 308-FR-015
describe('the brands the garage takes and refuses', () => {
  it('lists the taken brands as green lamps under Lucrează pe, with their fuels', () => {
    expect(text(group('works')?.querySelector('h2'))).toBe('Lucrează pe');
    expect(chips('works')).toEqual([
      { fuels: 'benzină · motorină · hibrid', lamp: 'green', name: 'BMW' },
      {
        fuels: 'benzină · motorină · hibrid · electric',
        lamp: 'green',
        name: 'Mini',
      },
      {
        fuels: 'benzină · motorină · hibrid · electric',
        lamp: 'green',
        name: 'Mercedes-Benz',
      },
      {
        fuels: 'benzină · motorină · hibrid · electric',
        lamp: 'green',
        name: 'Audi',
      },
      {
        fuels: 'benzină · motorină · hibrid · electric',
        lamp: 'green',
        name: 'Volkswagen',
      },
      {
        fuels: 'benzină · motorină · hibrid · electric',
        lamp: 'green',
        name: 'Škoda',
      },
    ]);
  });

  it('lists the refused brands as red lamps under Nu lucrează pe, with no fuel line, then the note', () => {
    expect(text(group('refuses')?.querySelector('h2'))).toBe('Nu lucrează pe');
    expect(chips('refuses')).toEqual(
      ['Dacia', 'Toyota', 'Ford', 'Tesla'].map((name) => ({
        fuels: '',
        lamp: 'red',
        name,
      })),
    );
    expect(group('refuses')?.querySelectorAll('.fuels').length).toBe(0);
    expect(text(section().querySelector('.brand-note'))).toBe(NOTE);
  });

  it('hides every lamp dot from assistive technology, the name staying text', () => {
    const dots = [...section().querySelectorAll('mf-lamp .mf-lamp-dot')];

    expect(dots.length).toBe(10);
    expect(
      dots.every((dot) => dot.getAttribute('aria-hidden') === 'true'),
    ).toBe(true);
  });

  it('writes the fuels in the fixed order, whatever order they came in', async () => {
    await show({ worksOn: [taken('BMW', ['electric', 'hybrid', 'petrol'])] });

    expect(chips('works')[0].fuels).toBe('benzină · hibrid · electric');
  });

  it('gives a taken brand with no fuel no second line', async () => {
    await show({ worksOn: [taken('BMW', [])] });

    expect(group('works')?.querySelector('.fuels')).toBeNull();
  });

  it('puts the brand in context first in the list holding it, the rest in order', async () => {
    await show({
      brand: {
        id: 'b-Audi',
        name: 'Audi',
        slug: 'audi',
        stance: 'works_on',
      },
    });

    expect(chips('works').map((chip) => chip.name)).toEqual([
      'Audi',
      'BMW',
      'Mini',
      'Mercedes-Benz',
      'Volkswagen',
      'Škoda',
    ]);
  });

  it('puts a refused brand in context first among the refused', async () => {
    await show({
      brand: {
        id: 'b-Ford',
        name: 'Ford',
        slug: 'ford',
        stance: 'does_not_take',
      },
    });

    expect(chips('refuses').map((chip) => chip.name)).toEqual([
      'Ford',
      'Dacia',
      'Toyota',
      'Tesla',
    ]);
    expect(chips('works')[0].name).toBe('BMW');
  });

  it('leaves the lists as they are for a brand in neither', async () => {
    await show({
      brand: {
        id: 'b-Fiat',
        name: 'Fiat',
        slug: 'fiat',
        stance: 'does_not_take',
      },
    });

    expect(chips('refuses').map((chip) => chip.name)).toEqual([
      'Dacia',
      'Toyota',
      'Ford',
      'Tesla',
    ]);
    expect(text(section())).not.toContain('Fiat');
  });

  it('hides Nu lucrează pe when nothing is refused, keeping the note', async () => {
    await show({ doesNotTake: [] });

    expect(group('refuses')).toBeNull();
    expect(text(section().querySelector('.brand-note'))).toBe(NOTE);
  });

  it('shows no note line without a note', async () => {
    await show({ brandNote: null });

    expect(section().querySelector('.brand-note')).toBeNull();
  });

  it('hides Lucrează pe when nothing is taken', async () => {
    await show({ worksOn: [] });

    expect(group('works')).toBeNull();
    expect(group('refuses')).not.toBeNull();
  });

  it('shows nothing at all with no brand, no facility and no payment', async () => {
    await show({ doesNotTake: [], worksOn: [] });

    expect(section().querySelector('.brand-note')).toBeNull();
    expect(section().hidden).toBe(true);
    expect(text(section())).toBe('');
  });

  it('says it in English', async () => {
    await english();

    expect(text(group('works')?.querySelector('h2'))).toBe('Works on');
    expect(text(group('refuses')?.querySelector('h2'))).toBe(
      'Does not work on',
    );
    expect(chips('works')[0].fuels).toBe('petrol · diesel · hybrid');
    expect(chips('works')[1].fuels).toBe('petrol · diesel · hybrid · electric');
    expect(text(section().querySelector('.brand-note'))).toBe(NOTE);
  });
});

// @traces 308-FR-008
// @traces 308-FR-009
// @traces 308-FR-010
// @traces 308-FR-015
describe('the facilities, the courtesy car and the payment', () => {
  it('lists the facilities in the order given, with the listing labels', async () => {
    await show({ facilities: ['pickup_dropoff', 'waiting_area'] });

    expect(text(group('facilities')?.querySelector('h2'))).toBe('Facilități');
    expect(facilities()).toEqual(['Preluare și predare', 'Sală de așteptare']);
  });

  it('marks a free courtesy car', async () => {
    await show({
      courtesyCar: { paid: false },
      facilities: ['courtesy_car', 'waiting_area'],
    });

    expect(facilities()).toEqual([
      'Mașină la schimb · gratuit',
      'Sală de așteptare',
    ]);
  });

  it('prices a paid courtesy car per day in whole lei', async () => {
    await show({
      courtesyCar: { paid: true, pricePerDayBani: 15_000 },
      facilities: ['courtesy_car'],
    });

    expect(facilities()).toEqual(['Mașină la schimb · 150 lei / zi']);
  });

  it('groups the thousands of the price by the language', async () => {
    await show({
      courtesyCar: { paid: true, pricePerDayBani: 150_000 },
      facilities: ['courtesy_car'],
    });

    expect(facilities()).toEqual(['Mașină la schimb · 1.500 lei / zi']);
    await english();
    expect(facilities()).toEqual(['Courtesy car · 1,500 lei / day']);
  });

  it('shows a paid courtesy car with no price as the bare label', async () => {
    await show({ courtesyCar: { paid: true }, facilities: ['courtesy_car'] });

    expect(facilities()).toEqual(['Mașină la schimb']);
  });

  it('lists the payment methods in the fixed order', async () => {
    await show({
      paymentMethods: { card: true, cash: true, transfer: false },
    });

    expect(text(section().querySelector('.payment'))).toBe(
      'Plată: numerar, card',
    );
    await show({ paymentMethods: { card: true, cash: true, transfer: true } });
    expect(text(section().querySelector('.payment'))).toBe(
      'Plată: numerar, card, transfer',
    );
    await show({
      paymentMethods: { card: true, cash: false, transfer: false },
    });
    expect(text(section().querySelector('.payment'))).toBe('Plată: card');
  });

  it('hides the payment line when no method is ticked', async () => {
    await show({ facilities: ['waiting_area'] });

    expect(section().querySelector('.payment')).toBeNull();
  });

  it('shows the facilities note as written after the payment line', async () => {
    await show({
      facilities: ['waiting_area'],
      facilitiesNote: FACILITIES_NOTE,
      paymentMethods: { card: true, cash: false, transfer: false },
    });

    const lines = [
      ...(group('facilities')?.querySelectorAll('.payment, .facilities-note') ??
        []),
    ].map((el) => el.className.includes('payment'));
    expect(lines).toEqual([true, false]);
    expect(text(section().querySelector('.facilities-note'))).toBe(
      FACILITIES_NOTE,
    );
  });

  it('shows the group for a facilities note alone', async () => {
    await show({ facilitiesNote: FACILITIES_NOTE });

    expect(group('facilities')).not.toBeNull();
    expect(facilities()).toEqual([]);
  });

  it('hides the group with no facility, no payment and no note', () => {
    expect(group('facilities')).toBeNull();
  });

  it('shows the facilities alone when the garage lists no brand', async () => {
    await show({
      doesNotTake: [],
      facilities: ['waiting_area'],
      worksOn: [],
    });

    expect(section().hidden).toBe(false);
    expect(group('works')).toBeNull();
    expect(facilities()).toEqual(['Sală de așteptare']);
  });

  it('says it in English', async () => {
    await show({
      courtesyCar: { paid: false },
      facilities: ['courtesy_car', 'pickup_dropoff'],
      facilitiesNote: FACILITIES_NOTE,
      paymentMethods: { card: true, cash: true, transfer: true },
    });
    await english();

    expect(text(group('facilities')?.querySelector('h2'))).toBe('Facilities');
    expect(facilities()).toEqual([
      'Courtesy car · free',
      'Pick-up and drop-off',
    ]);
    expect(text(section().querySelector('.payment'))).toBe(
      'Payment: cash, card, transfer',
    );
    expect(text(section().querySelector('.facilities-note'))).toBe(
      FACILITIES_NOTE,
    );
  });
});
