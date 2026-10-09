import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Period } from '@motor-fix/contracts/figure-choices';
import { I18n } from '@motor-fix/i18n';

import { AdminFilters } from './admin-filters';

const CITIES = [
  { key: 'all', name: 'Toată țara' },
  { key: 'bucuresti', name: 'București' },
  { key: 'cluj-napoca', name: 'Cluj-Napoca' },
];

@Component({
  imports: [AdminFilters],
  template: `<mf-admin-filters [cities]="cities" [city]="city()" [period]="period()" (choose)="chosen.push($event)" />`,
})
class Host {
  readonly cities = CITIES;
  readonly city = signal('bucuresti');
  readonly period = signal<Period>('7d');
  readonly chosen: { city: string; period: Period }[] = [];
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

beforeEach(() => {
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: false,
      media: query,
      removeEventListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

async function open(language: 'ro' | 'en' = 'ro') {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  document.body.append(fixture.nativeElement);
  await settle();
  return {
    element: fixture.nativeElement as HTMLElement,
    host: fixture.componentInstance,
  };
}

const select = (el: HTMLElement) =>
  el.querySelector('mf-admin-filters select') as HTMLSelectElement;
const segments = (el: HTMLElement) =>
  el.querySelector(
    'mf-admin-filters .segments[role="radiogroup"]',
  ) as HTMLElement;
const radios = (el: HTMLElement) => [
  ...segments(el).querySelectorAll<HTMLInputElement>('input[type="radio"]'),
];
const button = (el: HTMLElement) =>
  el.querySelector('mf-admin-filters button.filter') as HTMLButtonElement;
const sheet = () => document.querySelector('mf-admin-filters-sheet');

// @traces 163-FR-008
describe('the admin filters', () => {
  it('lists the cities in a drop-down named for the city, the current one selected', async () => {
    const { element } = await open();

    expect([...select(element).options].map((o) => o.text.trim())).toEqual([
      'Toată țara',
      'București',
      'Cluj-Napoca',
    ]);
    expect(select(element).value).toBe('bucuresti');
    expect(select(element).getAttribute('aria-label')).toBe('Oraș');
  });

  it('offers the six periods in order as one radio group, the current one checked', async () => {
    const { element } = await open();

    expect(segments(element).getAttribute('aria-label')).toBe('Perioadă');
    expect(
      radios(element).map((r) => r.closest('label')?.textContent?.trim()),
    ).toEqual([
      'Implicit',
      'Azi',
      'Ultimele 7 zile',
      'Ultimele 30 de zile',
      'Luna aceasta',
      'Ultimele 12 luni',
    ]);
    expect(radios(element).map((r) => r.checked)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(new Set(radios(element).map((r) => r.name)).size).toBe(1);
  });

  it('chooses a city from the drop-down, keeping the period', async () => {
    const { element, host } = await open();

    select(element).value = 'cluj-napoca';
    select(element).dispatchEvent(new Event('change'));

    expect(host.chosen).toEqual([{ city: 'cluj-napoca', period: '7d' }]);
  });

  it('chooses a period from the segments, keeping the city', async () => {
    const { element, host } = await open();

    radios(element)[5].click();

    expect(host.chosen).toEqual([{ city: 'bucuresti', period: '12m' }]);
  });

  // @traces 163-FR-009
  // The address catches up after each choice; one made before it has must
  // not undo the other.
  it('keeps a period just chosen when a city follows before the address has caught up', async () => {
    const { element, host } = await open();

    radios(element)[5].click();
    select(element).value = 'cluj-napoca';
    select(element).dispatchEvent(new Event('change'));

    expect(host.chosen).toEqual([
      { city: 'bucuresti', period: '12m' },
      { city: 'cluj-napoca', period: '12m' },
    ]);
  });

  it('keeps a city just chosen when a period follows before the address has caught up', async () => {
    const { element, host } = await open();

    select(element).value = 'cluj-napoca';
    select(element).dispatchEvent(new Event('change'));
    radios(element)[5].click();

    expect(host.chosen).toEqual([
      { city: 'cluj-napoca', period: '7d' },
      { city: 'cluj-napoca', period: '12m' },
    ]);
  });

  it('follows the choice on the address once it changes', async () => {
    const { element, host } = await open();

    radios(element)[5].click();
    host.city.set('all');
    host.period.set('30d');
    await settle();
    select(element).value = 'cluj-napoca';
    select(element).dispatchEvent(new Event('change'));

    expect(host.chosen.at(-1)).toEqual({ city: 'cluj-napoca', period: '30d' });
  });

  it("names the phone's filter button for what is chosen", async () => {
    const { element, host } = await open();
    expect(button(element).getAttribute('aria-label')).toBe(
      'Filtre: București, Ultimele 7 zile',
    );

    host.city.set('all');
    host.period.set('default');
    await settle();
    expect(button(element).getAttribute('aria-label')).toBe(
      'Filtre: Toată țara, Implicit',
    );
  });

  it('names it in English', async () => {
    const { element } = await open('en');

    expect(button(element).getAttribute('aria-label')).toBe(
      'Filters: București, Last 7 days',
    );
  });

  it('opens the sheet from the button and chooses what it applies', async () => {
    const { element, host } = await open();

    button(element).click();
    await settle();
    expect(sheet()).not.toBeNull();
    const city = [
      ...(sheet() as Element).querySelectorAll<HTMLInputElement>('input'),
    ].find((r) => r.value === 'cluj-napoca') as HTMLInputElement;
    city.click();
    (
      [...(sheet() as Element).querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Aplică',
      ) as HTMLButtonElement
    ).click();
    await settle();

    expect(host.chosen).toEqual([{ city: 'cluj-napoca', period: '7d' }]);
  });

  it('chooses nothing when the sheet is closed with Escape', async () => {
    const { element, host } = await open();

    button(element).click();
    await settle();
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(sheet()).toBeNull();
    expect(host.chosen).toEqual([]);
  });
});
