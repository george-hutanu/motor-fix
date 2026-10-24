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

const GARAGE: PublicGarageDto = {
  brandNote: null,
  doesNotTake: [],
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
  worksOn: [],
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
const names = (group: 'works' | 'refuses') =>
  [...section().querySelectorAll(`.group.${group} li`)].map((li) =>
    text(li.querySelector('mf-lamp')),
  );

// @traces 308-FR-004
// @traces 308-FR-005
// @traces 308-FR-015
describe('the brands, under odd answers', () => {
  it('shows a brand name and a note holding markup as plain text', async () => {
    const note = 'Fără <script>alert(1)</script> & "mărci"';
    await show({
      brandNote: note,
      worksOn: [taken('<b>BMW</b>')],
    });

    expect(names('works')).toEqual(['<b>BMW</b>']);
    expect(text(section().querySelector('.brand-note'))).toBe(note);
    expect(section().querySelector('b, script')).toBeNull();
  });

  it('keeps a long list whole and in the order given, the brand in context first', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => taken(`Marca${i}`));
    await show({
      brand: {
        id: 'b-Marca1499',
        name: 'Marca1499',
        slug: 'marca1499',
        stance: 'works_on',
      },
      worksOn: many,
    });

    const shown = names('works');
    expect(shown.length).toBe(1500);
    expect(shown.slice(0, 3)).toEqual(['Marca1499', 'Marca0', 'Marca1']);
    expect(shown.at(-1)).toBe('Marca1498');
  }, 20_000);

  it('puts no control, link or per-chip label inside the section', async () => {
    await show({
      doesNotTake: [refused('Dacia')],
      worksOn: [taken('BMW')],
    });

    expect(
      section().querySelector('a, button, input, [aria-label], [title]'),
    ).toBeNull();
    expect(text(section().querySelector('.group.works li'))).toBe(
      'BMWbenzină · motorină · hibrid · electric',
    );
  });

  it('hides the whole section again when a new answer empties it', async () => {
    await show({ doesNotTake: [refused('Dacia')], worksOn: [taken('BMW')] });
    await show({});

    expect(text(section())).toBe('');
  });
});

// @traces 308-FR-009
// @traces 308-FR-010
describe('the facilities, under odd answers', () => {
  const FREE = { paid: false };

  it('shows no courtesy car line from terms alone when the facility is not listed', async () => {
    await show({
      courtesyCar: { paid: true, pricePerDayBani: 15000 },
      facilities: ['waiting_area'],
    });

    expect(text(section())).not.toMatch(/Mașină la schimb|gratuit|150/);
    expect(text(section())).toContain('Sală de așteptare');
  });

  it.each([
    [100, '1 lei / zi', '1 lei / day'],
    [199_900, '1.999 lei / zi', '1,999 lei / day'],
    [200_000, '2.000 lei / zi', '2,000 lei / day'],
  ])('prices a courtesy car of %i bani whole', async (bani, ro, en) => {
    await show({
      courtesyCar: { paid: true, pricePerDayBani: bani },
      facilities: ['courtesy_car'],
    });
    expect(text(section())).toContain(`Mașină la schimb · ${ro}`);

    await english();
    expect(text(section())).toContain(`Courtesy car · ${en}`);
  });

  it('shows the free courtesy car without any price', async () => {
    await show({
      courtesyCar: FREE,
      facilities: ['courtesy_car'],
    });

    expect(text(section())).toContain('Mașină la schimb · gratuit');
    expect(text(section())).not.toContain('lei');
  });

  it('shows a facilities note holding markup as plain text', async () => {
    await show({ facilitiesNote: '<i>wifi</i> & cafea' });

    expect(text(section())).toBe('Facilități<i>wifi</i> & cafea');
    expect(section().querySelector('i')).toBeNull();
  });
});
