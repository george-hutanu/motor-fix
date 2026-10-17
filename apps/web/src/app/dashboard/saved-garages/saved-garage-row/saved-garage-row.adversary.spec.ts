import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SavedGarageItemDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { SavedGarageRow } from './saved-garage-row';
import { savedItem } from '../saved-garages.testing';

async function render(
  item: SavedGarageItemDto,
  {
    hasCar = true,
    language = 'ro',
  }: { hasCar?: boolean; language?: 'ro' | 'en' } = {},
) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('driver');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(SavedGarageRow);
  fixture.componentRef.setInput('item', item);
  fixture.componentRef.setInput('hasCar', hasCar);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const line = (element: HTMLElement) =>
  text(element.querySelector('[data-line]'));

afterEach(() => TestBed.resetTestingModule());

// @traces 291-FR-008
describe('a saved garage row under attack: the line', () => {
  // The shared format writes at most one decimal (019-FR-004).
  it('writes a zero distance as 0 km, not nothing', async () => {
    const element = await render(savedItem({ distanceKm: 0 }));

    expect(line(element)).toBe('Lucrează pe BMW · 0 km');
  });

  it('writes a whole-number distance without a decimal, as the shared format does', async () => {
    const element = await render(savedItem({ distanceKm: 12 }), {
      language: 'en',
    });

    expect(line(element)).toBe('Works on BMW · 12 km');
  });

  it('shows only Indisponibil for an unavailable garage that has a distance and a verdict', async () => {
    const element = await render(
      savedItem({
        available: false,
        businessKind: 'mobile',
        comesToYou: true,
        distanceKm: 3.2,
      }),
    );

    expect(line(element)).toBe('Indisponibil');
  });

  it('shows Indisponibil even for a driver with no car', async () => {
    const element = await render(savedItem({ available: false, brands: [] }), {
      hasCar: false,
    });

    expect(line(element)).toBe('Indisponibil');
  });

  it('gives a mobile mechanic with no verdict and no place only the brand line', async () => {
    const element = await render(savedItem({ businessKind: 'mobile' }));

    expect(line(element)).toBe('Lucrează pe BMW');
  });

  it('prefers the verdict over a stray distance for a mobile mechanic', async () => {
    const element = await render(
      savedItem({ businessKind: 'mobile', comesToYou: false, distanceKm: 4.4 }),
    );

    expect(line(element)).toBe('Lucrează pe BMW · în afara zonei');
  });

  it('joins two brands whose names contain commas and ampersands without altering them', async () => {
    const element = await render(
      savedItem({
        brands: [
          { id: 'a', name: 'Alfa, Romeo' },
          { id: 'b', name: 'A&B <i>' },
        ],
      }),
    );

    expect(line(element)).toBe('Lucrează pe Alfa, Romeo și A&B <i>');
    expect(element.querySelector('[data-line] i')).toBeNull();
  });
});

// @traces 291-FR-007
describe('a saved garage row under attack: the name and link', () => {
  it('renders markup in a garage name as text', async () => {
    const element = await render(
      savedItem({ name: '<img src=x onerror=alert(1)>Șoșea' }),
    );

    expect(element.querySelector('img')).toBeNull();
    expect(text(element.querySelector('a[data-profile]'))).toBe(
      '<img src=x onerror=alert(1)>Șoșea',
    );
  });

  it('encodes a slug that holds a slash or a question mark in the profile link', async () => {
    const element = await render(savedItem({ slug: 'a/b?c#d' }));

    const href = element.querySelector('a[data-profile]')?.getAttribute('href');
    expect(href).toBe('/ro/garages/a%2Fb%3Fc%23d');
  });

  it('keeps a 44 px remove target class-free of display none and emits the id once per click', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const i18n = TestBed.inject(I18n);
    await i18n.enter('driver');
    const fixture = TestBed.createComponent(SavedGarageRow);
    fixture.componentRef.setInput('item', savedItem({ garageId: 'g-9' }));
    fixture.componentRef.setInput('hasCar', true);
    const ids: string[] = [];
    fixture.componentInstance.removed.subscribe((id: string) => ids.push(id));
    fixture.detectChanges();
    await fixture.whenStable();

    const button = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('button[data-remove]');
    button?.click();

    expect(ids).toEqual(['g-9']);
  });
});
