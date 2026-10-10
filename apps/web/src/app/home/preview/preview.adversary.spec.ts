import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { BrandDto, HomeGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { HomePreview } from './preview';

const DACIA: BrandDto = {
  id: 'd',
  name: 'Dacia',
  popularity: 7,
  slug: 'dacia',
};

const garageOf = (over: Partial<HomeGarageDto> = {}): HomeGarageDto => ({
  businessKind: 'company',
  city: 'București',
  id: 'g',
  labourFromLei: 180,
  name: 'Service',
  rating: 4.9,
  reviewCount: 120,
  slug: 'service',
  stance: 'works_on',
  ...over,
});

let fixture: ComponentFixture<HomePreview>;

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  await TestBed.inject(I18n).enter('public');
});

async function render(
  garages: HomeGarageDto[],
  brand: BrandDto = DACIA,
  loading = false,
) {
  fixture = TestBed.createComponent(HomePreview);
  fixture.componentRef.setInput('brand', brand);
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

// @traces 226-FR-002
describe('HomePreview with unusual lists', () => {
  it('shows no row and no skeleton for an empty list', async () => {
    const page = await render([]);

    expect(page.querySelectorAll('li')).toHaveLength(0);
  });

  it('shows the skeletons, not the garages, while loading with garages still held', async () => {
    const page = await render([garageOf()], DACIA, true);

    expect(page.querySelectorAll('.row.skeleton')).toHaveLength(3);
    expect(rows(page)).toHaveLength(0);
  });

  it('shows three red lamps when only refusing garages come', async () => {
    const page = await render(
      ['a', 'b', 'c'].map((id) =>
        garageOf({ id, slug: id, stance: 'does_not_take' }),
      ),
    );

    expect(
      [...page.querySelectorAll('mf-lamp')].map((lamp) =>
        lamp.getAttribute('data-state'),
      ),
    ).toEqual(['red', 'red', 'red']);
  });
});

// @traces 226-FR-002
describe('HomePreview ratings and rates', () => {
  it.each([
    [1, '1,0'],
    [5, '5,0'],
    [4.5, '4,5'],
  ])('writes a rating of %s as %s in Romanian', async (rating, text) => {
    const [row] = rows(await render([garageOf({ rating })]));

    expect(said(row.querySelector('.rating') ?? undefined)).toBe(text);
  });

  it('writes a rating of 5 as 5.0 in English', async () => {
    await TestBed.inject(I18n).use('en');
    const [row] = rows(await render([garageOf({ rating: 5 })]));

    expect(said(row.querySelector('.rating') ?? undefined)).toBe('5.0');
  });

  it('shows no rating number for a garage with no reviews, whatever its count says', async () => {
    const [row] = rows(
      await render([garageOf({ rating: null, reviewCount: 0 })]),
    );

    expect(said(row.querySelector('.rating') ?? undefined)).toBe(
      'Fără recenzii',
    );
  });

  it('shows a rate of one lei', async () => {
    const [row] = rows(await render([garageOf({ labourFromLei: 1 })]));

    expect(said(row)).toContain('de la 1 lei/oră');
  });

  it('groups a large rate the Romanian way, never as NaN or undefined', async () => {
    const [row] = rows(await render([garageOf({ labourFromLei: 1250 })]));

    expect(said(row)).toContain('de la 1.250 lei/oră');
    expect(said(row)).not.toMatch(/NaN|undefined|null/);
  });
});

// @traces 226-FR-008
describe('HomePreview with hostile text', () => {
  it('shows markup in a name as text and builds no element from it', async () => {
    const name = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const page = await render([garageOf({ name })]);

    expect(page.querySelector('img')).toBeNull();
    expect(page.querySelector('script')).toBeNull();
    expect(said(page.querySelector('.name') ?? undefined)).toBe(name);
  });

  it('shows a brand name with markup as text in the lamp label', async () => {
    const page = await render([garageOf()], {
      ...DACIA,
      name: '<b>Dacia</b>',
    });

    expect(page.querySelector('mf-lamp b')).toBeNull();
    expect(said(page.querySelector('mf-lamp') ?? undefined)).toBe(
      'Lucrează pe <b>Dacia</b>',
    );
  });

  it('encodes a slug with odd characters in the link and keeps it one link', async () => {
    const page = await render([garageOf({ slug: 'a b/c?d' })]);

    const [row] = rows(page);
    expect(row.getAttribute('href')).not.toContain(' ');
    expect(row.getAttribute('href')).toContain('?brand=dacia');
  });

  it('keeps a name of 500 unbroken characters whole inside one row', async () => {
    const page = await render([garageOf({ name: 'W'.repeat(500) })]);

    const name = page.querySelector<HTMLElement>('.name');
    expect(name?.textContent).toHaveLength(500);
    expect(rows(page)).toHaveLength(1);
  });
});

// @traces 226-FR-007
describe('HomePreview on a language switch', () => {
  it('keeps the same rows and links and re-writes the words and formats', async () => {
    const page = await render([
      garageOf(),
      garageOf({ id: 'r', rating: null, slug: 'r', stance: 'does_not_take' }),
    ]);
    const before = rows(page);

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();
    await fixture.whenStable();

    const after = rows(page);
    expect(after).toHaveLength(2);
    expect(after.map((row) => row.getAttribute('href'))).toEqual([
      '/en/garages/service?brand=dacia',
      '/en/garages/r?brand=dacia',
    ]);
    expect(after[0]).toBe(before[0]);
    expect(said(after[0])).toContain('Works on Dacia');
    expect(said(after[0])).toContain('4.9');
    expect(said(after[1])).toContain('No reviews yet');
  });
});
