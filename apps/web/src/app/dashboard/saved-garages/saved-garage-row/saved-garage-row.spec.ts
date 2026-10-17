import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SavedGarageItemDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { SavedGarageRow } from './saved-garage-row';
import { savedItem } from '../saved-garages.testing';

async function render(
  item: SavedGarageItemDto,
  options: { hasCar?: boolean | undefined; language?: 'ro' | 'en' } = {},
) {
  const { language = 'ro' } = options;
  const hasCar = 'hasCar' in options ? options.hasCar : true;
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
  const element = fixture.nativeElement as HTMLElement;
  return { element, fixture };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const line = (element: HTMLElement) =>
  text(element.querySelector('[data-line]'));
const lamp = (element: HTMLElement) =>
  element.querySelector<HTMLElement>('mf-lamp');

afterEach(() => TestBed.resetTestingModule());

const BMW = { id: 'brand-bmw', name: 'BMW' };
const MINI = { id: 'brand-mini', name: 'Mini' };
const DACIA = { id: 'brand-dacia', name: 'Dacia' };

// @traces 291-FR-007
describe('a saved garage’s row', () => {
  it('opens the garage’s profile in the reader’s language', async () => {
    const { element } = await render(savedItem());

    const link = element.querySelector<HTMLAnchorElement>('a[data-profile]');
    expect(link?.getAttribute('href')).toBe('/ro/garages/auto-service-popescu');
    expect(text(link)).toContain('Auto Service Popescu');
  });

  it('opens the English profile for an English reader', async () => {
    const { element } = await render(savedItem(), { language: 'en' });

    expect(element.querySelector('a[data-profile]')?.getAttribute('href')).toBe(
      '/en/garages/auto-service-popescu',
    );
  });

  it('shows the shared rating dial, small, with the rating', async () => {
    const { element } = await render(savedItem({ rating: 4.6 }));

    const dial = element.querySelector<HTMLElement>('mf-rating-dial');
    expect(dial?.dataset['size']).toBe('small');
    expect(text(dial)).toContain('4,6');
  });

  it('shows the dial’s unrated state for a garage with no rating', async () => {
    const { element } = await render(
      savedItem({ rating: null, reviewCount: 0 }),
    );

    expect(text(element.querySelector('mf-rating-dial'))).not.toMatch(/\d/);
  });

  it('has a remove button named for what it does, apart from the link', async () => {
    const { element, fixture } = await render(savedItem());
    const removed: string[] = [];
    fixture.componentInstance.removed.subscribe((id: string) =>
      removed.push(id),
    );

    const button = element.querySelector<HTMLButtonElement>(
      'button[data-remove]',
    );
    expect(button?.getAttribute('aria-label')).toBe('Scoate din salvate');
    expect(button?.closest('a')).toBeNull();
    button?.click();

    expect(removed).toEqual(['garage-1']);
  });

  it('names the remove button in English', async () => {
    const { element } = await render(savedItem(), { language: 'en' });

    expect(
      element.querySelector('button[data-remove]')?.getAttribute('aria-label'),
    ).toBe('Remove from saved');
  });
});

// @traces 291-FR-007
describe('the row as a card', () => {
  // jsdom computes no stylesheet, so the row's own rules are read: the same
  // panel, line and radius tokens as the result and Home cards.
  const host = (() => {
    const css = readFileSync(join(__dirname, 'saved-garage-row.css'), 'utf8');
    return css.match(/:host\s*\{([^}]*)\}/)?.[1] ?? '';
  })();

  it('draws each row on the card surface, bordered and rounded', () => {
    expect(host).toMatch(/background:\s*var\(--mf-panel\)/);
    expect(host).toMatch(/border:\s*1px solid var\(--mf-line\)/);
    expect(host).toMatch(/border-radius:\s*var\(--mf-radius-panel\)/);
  });

  it('pads the card, so the link and the remove button stay inside it', () => {
    expect(host).toMatch(/padding(-inline)?:\s*[^;]*var\(--mf-space-/);
    expect(host).toMatch(/box-sizing:\s*border-box/);
  });
});

// @traces 291-FR-008
describe('the row’s lamp line', () => {
  it.each([
    [[BMW], 'Lucrează pe BMW'],
    [[BMW, MINI], 'Lucrează pe BMW și Mini'],
    [[BMW, MINI, DACIA], 'Lucrează pe BMW, Mini și Dacia'],
  ])(
    'lights green and names the brands it works on: %j',
    async (brands, said) => {
      const { element } = await render(savedItem({ brands }));

      expect(lamp(element)?.dataset['state']).toBe('green');
      expect(line(element)).toBe(said);
    },
  );

  it.each([
    [[BMW], 'Works on BMW'],
    [[BMW, MINI], 'Works on BMW and Mini'],
    [[BMW, MINI, DACIA], 'Works on BMW, Mini and Dacia'],
  ])('says it in English: %j', async (brands, said) => {
    const { element } = await render(savedItem({ brands }), { language: 'en' });

    expect(line(element)).toBe(said);
  });

  it('lights red when the garage works on none of the driver’s cars', async () => {
    const { element } = await render(savedItem({ brands: [] }));

    expect(lamp(element)?.dataset['state']).toBe('red');
    expect(line(element)).toBe('Nu lucrează pe mașinile tale');
  });

  it('says the red line in English', async () => {
    const { element } = await render(savedItem({ brands: [] }), {
      language: 'en',
    });

    expect(line(element)).toBe('Does not work on your cars');
  });

  it('is grey and asks for a car when the driver has none', async () => {
    const { element } = await render(savedItem({ brands: [] }), {
      hasCar: false,
    });

    expect(lamp(element)?.dataset['state']).toBe('grey');
    expect(line(element)).toBe(
      'Adaugă o mașină ca să vezi dacă lucrează pe ea',
    );
  });

  it('asks for a car in English', async () => {
    const { element } = await render(savedItem({ brands: [] }), {
      hasCar: false,
      language: 'en',
    });

    expect(line(element)).toBe('Add a car to see whether it works on it');
  });

  it('says no verdict while the driver’s cars are not known, only the distance', async () => {
    const { element } = await render(
      savedItem({ brands: [], distanceKm: 2.4 }),
      { hasCar: undefined },
    );

    expect(lamp(element)).toBeNull();
    expect(line(element)).toBe('2,4 km');
  });

  it('still names the brands it works on while the cars are not known', async () => {
    const { element } = await render(savedItem(), { hasCar: undefined });

    expect(lamp(element)?.dataset['state']).toBe('green');
    expect(line(element)).toBe('Lucrează pe BMW');
  });

  it('hides the lamp’s dot from assistive technology', async () => {
    const { element } = await render(savedItem());

    expect(
      lamp(element)?.querySelector('.mf-lamp-dot')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });
});

// @traces 291-FR-008
// @traces 291-FR-010
describe('the row’s distance', () => {
  it('follows the brand line with the distance to one decimal', async () => {
    const { element } = await render(savedItem({ distanceKm: 2.4 }));

    expect(line(element)).toBe('Lucrează pe BMW · 2,4 km');
  });

  it('writes the distance the English way', async () => {
    const { element } = await render(savedItem({ distanceKm: 2.4 }), {
      language: 'en',
    });

    expect(line(element)).toBe('Works on BMW · 2.4 km');
  });

  it('follows the red line with the distance too', async () => {
    const { element } = await render(
      savedItem({ brands: [], distanceKm: 12.5 }),
    );

    expect(line(element)).toBe('Nu lucrează pe mașinile tale · 12,5 km');
  });

  it.each([
    [true, 'ro', 'Lucrează pe BMW · vine la tine'],
    [false, 'ro', 'Lucrează pe BMW · în afara zonei'],
    [true, 'en', 'Works on BMW · comes to you'],
    [false, 'en', 'Works on BMW · outside its area'],
  ] as const)(
    'gives a mobile mechanic its area verdict, never a distance (%s, %s)',
    async (comesToYou, language, said) => {
      const { element } = await render(
        savedItem({ businessKind: 'mobile', comesToYou, distanceKm: null }),
        { language },
      );

      expect(line(element)).toBe(said);
    },
  );

  it('shows nothing after the line, and no separator, without a place', async () => {
    const { element } = await render(savedItem());

    expect(line(element)).toBe('Lucrează pe BMW');
  });

  it('shows no distance for a fixed garage without a position', async () => {
    const { element } = await render(savedItem({ distanceKm: null }));

    expect(line(element)).toBe('Lucrează pe BMW');
  });
});

// @traces 291-FR-008
describe('an unavailable saved garage', () => {
  const suspended = () =>
    savedItem({ available: false, distanceKm: 2.4, rating: 4.2 });

  it('is greyed and says Indisponibil in place of the lamp line', async () => {
    const { element } = await render(suspended());

    expect(element.querySelector('[data-unavailable]')).not.toBeNull();
    expect(lamp(element)).toBeNull();
    expect(line(element)).toBe('Indisponibil');
  });

  it('says Unavailable in English', async () => {
    const { element } = await render(suspended(), { language: 'en' });

    expect(line(element)).toBe('Unavailable');
  });

  it('still opens the profile, keeps its rating and its remove button', async () => {
    const { element } = await render(suspended());

    expect(element.querySelector('a[data-profile]')?.getAttribute('href')).toBe(
      '/ro/garages/auto-service-popescu',
    );
    expect(text(element.querySelector('mf-rating-dial'))).toContain('4,2');
    expect(element.querySelector('button[data-remove]')).not.toBeNull();
  });
});

// @traces 291-FR-014
describe('the saved garages texts', () => {
  const texts = (language: 'ro' | 'en') =>
    JSON.parse(
      readFileSync(
        join(
          __dirname,
          '../../../../../../../libs/i18n/src/driver',
          `${language}.json`,
        ),
        'utf8',
      ),
    ).saved as Record<string, unknown>;
  const leaves = (value: unknown, at = ''): [string, string][] =>
    typeof value === 'string'
      ? [[at, value]]
      : Object.entries(value as Record<string, unknown>).flatMap(
          ([key, each]) => leaves(each, at ? `${at}.${key}` : key),
        );

  it('has every text in Romanian and English, none left untranslated', () => {
    const ro = texts('ro');
    const en = texts('en');
    // A count's forms differ by language (Romanian has "few"), not its key.
    const romanian = new Map(leaves(ro));

    expect(Object.keys(en).sort()).toEqual(Object.keys(ro).sort());
    for (const [key, said] of leaves(en)) {
      expect(said.trim()).not.toBe('');
      expect(said).not.toBe(romanian.get(key));
    }
  });
});
