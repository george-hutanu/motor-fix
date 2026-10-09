import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { AdminFiltersSheet, type FiltersChoice } from './admin-filters-sheet';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const CITIES = [
  { key: 'all', name: 'Toată țara' },
  { key: 'bucuresti', name: 'București' },
  { key: 'cluj-napoca', name: 'Cluj-Napoca' },
];

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

async function open(
  language: 'ro' | 'en' = 'ro',
  cities: () => typeof CITIES = () => CITIES,
) {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  const result: Promise<OverlayResult<FiltersChoice>> =
    host.componentInstance.overlays.open<FiltersChoice, unknown>(
      AdminFiltersSheet,
      {
        confirmDiscard: false,
        data: { cities, city: 'bucuresti', period: '7d' },
        shape: 'dialog',
        title: 'shell.frame.admin.filters.title',
      },
    );
  await settle();
  return result;
}

const sheet = () =>
  document.querySelector<HTMLElement>('mf-admin-filters-sheet') as HTMLElement;
const group = (name: string) =>
  [...sheet().querySelectorAll<HTMLElement>('[role="radiogroup"]')].find(
    (g) => g.getAttribute('aria-label') === name,
  ) as HTMLElement;
const options = (g: HTMLElement) =>
  [...g.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => ({
    checked: r.checked,
    name: r.closest('label')?.textContent?.trim(),
  }));
const pick = (g: HTMLElement, name: string) => {
  const radio = [...g.querySelectorAll<HTMLInputElement>('input')].find(
    (r) => r.closest('label')?.textContent?.trim() === name,
  ) as HTMLInputElement;
  radio.click();
};
const apply = () =>
  (
    [...sheet().querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Aplică',
    ) as HTMLButtonElement
  ).click();

// @traces 163-FR-008 163-FR-012
describe('the admin filters sheet', () => {
  it('lists the cities and then the six periods, the current ones checked', async () => {
    void open();

    expect(options(group('Oraș'))).toEqual([
      { checked: false, name: 'Toată țara' },
      { checked: true, name: 'București' },
      { checked: false, name: 'Cluj-Napoca' },
    ]);
    expect(options(group('Perioadă'))).toEqual([
      { checked: false, name: 'Implicit' },
      { checked: false, name: 'Azi' },
      { checked: true, name: 'Ultimele 7 zile' },
      { checked: false, name: 'Ultimele 30 de zile' },
      { checked: false, name: 'Luna aceasta' },
      { checked: false, name: 'Ultimele 12 luni' },
    ]);
  });

  it('lists the cities that arrive after it opened', async () => {
    const cities = signal(CITIES.slice(0, 1));
    void open('ro', cities);
    await settle();
    expect(options(group('Oraș')).map((o) => o.name)).toEqual(['Toată țara']);

    cities.set(CITIES);
    await settle();
    expect(options(group('Oraș')).map((o) => o.name)).toEqual([
      'Toată țara',
      'București',
      'Cluj-Napoca',
    ]);
  });

  it('applies the picked city and period', async () => {
    const result = open();
    await settle();

    pick(group('Oraș'), 'Cluj-Napoca');
    pick(group('Perioadă'), 'Ultimele 12 luni');
    await settle();
    apply();
    await settle();

    await expect(result).resolves.toEqual({
      city: 'cluj-napoca',
      period: '12m',
    });
  });

  it('changes nothing when closed with Escape', async () => {
    const result = open();
    await settle();

    pick(group('Oraș'), 'Cluj-Napoca');
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });

  it('reads in English', async () => {
    void open('en');
    await settle();

    expect(options(group('Period')).map((o) => o.name)).toEqual([
      'Default',
      'Today',
      'Last 7 days',
      'Last 30 days',
      'This month',
      'Last 12 months',
    ]);
    expect(sheet().textContent).toContain('Apply');
  });
});
