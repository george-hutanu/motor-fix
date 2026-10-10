import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { BrandDto, HomeGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { HomePreview } from './preview';

// @traces 226-FR-002
// @traces 226-FR-003
// @traces 226-FR-007
// @traces 226-FR-008

const DACIA: BrandDto = {
  id: 'd',
  name: 'Dacia',
  popularity: 7,
  slug: 'dacia',
};

const garageOf = (over: Partial<HomeGarageDto> = {}): HomeGarageDto => ({
  businessKind: 'company',
  city: 'București',
  doesNotTake: [],
  id: 'militari',
  labourFromLei: 180,
  name: 'Service Auto Militari',
  rating: 4.9,
  reviewCount: 120,
  slug: 'service-auto-militari',
  stance: 'works_on',
  worksOn: ['Dacia'],
  ...over,
});

let fixture: ComponentFixture<HomePreview>;

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  await TestBed.inject(I18n).enter('public');
});

async function render(
  garages: HomeGarageDto[],
  { loading = false, language = 'ro' as 'ro' | 'en' } = {},
) {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  fixture = TestBed.createComponent(HomePreview);
  fixture.componentRef.setInput('brand', DACIA);
  fixture.componentRef.setInput('garages', garages);
  fixture.componentRef.setInput('loading', loading);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const rows = (page: HTMLElement) => [
  ...page.querySelectorAll<HTMLAnchorElement>('a.row'),
];
const said = (el: Element | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

describe('HomePreview', () => {
  it('links each row to the garage profile in the current language, with the brand', async () => {
    const page = await render([
      garageOf(),
      garageOf({ id: 'b', slug: 'atelier-berceni' }),
    ]);

    expect(rows(page).map((row) => row.getAttribute('href'))).toEqual([
      '/ro/garages/service-auto-militari?brand=dacia',
      '/ro/garages/atelier-berceni?brand=dacia',
    ]);
  });

  it('shows a green lamp for a garage that works on the brand, red otherwise', async () => {
    const page = await render([
      garageOf(),
      garageOf({ id: 'r', slug: 'r', stance: 'does_not_take' }),
      garageOf({ id: 'u', slug: 'u', stance: 'unstated' }),
    ]);

    const lamps = [...page.querySelectorAll('mf-lamp')];
    expect(lamps.map((lamp) => lamp.getAttribute('data-state'))).toEqual([
      'green',
      'red',
      'red',
    ]);
    expect(lamps.map((lamp) => said(lamp))).toEqual([
      'Lucrează pe Dacia',
      'Nu primește Dacia',
      'Nu primește Dacia',
    ]);
  });

  it('shows the name, the rating and the hourly rate in Romanian', async () => {
    const [row] = rows(await render([garageOf()]));

    expect(said(row)).toContain('Service Auto Militari');
    expect(said(row)).toContain('4,9');
    expect(said(row)).toContain('de la 180 lei/oră');
  });

  it('says a garage has no reviews yet, and leaves out a rate it has not given', async () => {
    const [row] = rows(
      await render([garageOf({ labourFromLei: null, rating: null })]),
    );

    expect(said(row)).toContain('Fără recenzii');
    expect(said(row)).not.toContain('lei');
  });

  it('says it in English', async () => {
    const page = await render(
      [
        garageOf(),
        garageOf({ id: 'n', rating: null, slug: 'n', stance: 'does_not_take' }),
      ],
      { language: 'en' },
    );

    const [first, second] = rows(page);
    expect(first.getAttribute('href')).toBe(
      '/en/garages/service-auto-militari?brand=dacia',
    );
    expect(said(first)).toContain('Works on Dacia');
    expect(said(first)).toContain('4.9');
    expect(said(first)).toContain('from 180 lei/hour');
    expect(said(second)).toContain("Doesn't take Dacia");
    expect(said(second)).toContain('No reviews yet');
  });

  it('shows only the rows that exist', async () => {
    const page = await render([garageOf()]);

    expect(page.querySelectorAll('.row')).toHaveLength(1);
  });

  it('shows three skeleton rows and no link while it loads', async () => {
    const page = await render([], { loading: true });

    expect(page.querySelectorAll('.row.skeleton')).toHaveLength(3);
    expect(rows(page)).toHaveLength(0);
  });
  // @traces 227-FR-010
  it.each([
    ['works_on', 'Dacia', 'Lucrează pe\u00a0Dacia'],
    ['does_not_take', 'Dacia', 'Nu primește\u00a0Dacia'],
    ['does_not_take', 'Land Rover', 'Nu primește Land\u00a0Rover'],
  ] as const)(
    'keeps the last two words of a %s status for %s on one line',
    async (stance, name, shown) => {
      fixture = TestBed.createComponent(HomePreview);
      fixture.componentRef.setInput('brand', { ...DACIA, name });
      fixture.componentRef.setInput('garages', [garageOf({ stance })]);
      fixture.detectChanges();
      await fixture.whenStable();
      const lamp = (fixture.nativeElement as HTMLElement).querySelector(
        'mf-lamp',
      );

      expect(lamp?.textContent?.trim()).toBe(shown);
    },
  );

  // @traces 227-FR-010
  it('puts the name over the status on the left, the rating over the rate on the right', async () => {
    const [row] = rows(await render([garageOf()]));

    const left = row.querySelector('.who');
    const right = row.querySelector('.facts');
    expect(
      [...(left?.children ?? [])].map(
        (child) => child.className || child.localName,
      ),
    ).toEqual(['name', 'mf-lamp']);
    expect(
      [...(right?.children ?? [])].map((child) => child.className),
    ).toEqual(['rating', 'rate']);
  });
});
