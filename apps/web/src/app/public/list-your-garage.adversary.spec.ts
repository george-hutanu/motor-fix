import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { ListYourGarage } from './list-your-garage';

let tops = [1000, 2000, 3000, 4000, 5000, 6000];
const scrolls: ScrollIntoViewOptions[] = [];

beforeEach(() => {
  tops = [1000, 2000, 3000, 4000, 5000, 6000];
  scrolls.length = 0;
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const sections = [...document.querySelectorAll('section h2')];
      const top = tops[sections.indexOf(this)] ?? 0;
      return { bottom: top + 40, height: 40, top } as DOMRect;
    });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value: 8000,
  });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  Element.prototype.scrollIntoView = (options) => {
    scrolls.push(options as ScrollIntoViewOptions);
  };
});

afterEach(() => jest.restoreAllMocks());

async function open(path: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: ListYourGarage, path: ':lang/list-your-garage' },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: REDUCED_MOTION, useValue: signal(false) },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (path.startsWith('/en/')) await i18n.use('en');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(path);
  await settle(harness);
  return { harness, page: harness.routeNativeElement as HTMLElement };
}

async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 2; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/‑/g, '-').replace(/\s+/g, ' ').trim();
const entries = (page: HTMLElement) => [
  ...page.querySelectorAll<HTMLButtonElement>('nav ol button'),
];
const current = (page: HTMLElement) =>
  [...page.querySelectorAll('[aria-current="step"]')].map(text);
const bar = (page: HTMLElement) =>
  page.querySelector<HTMLButtonElement>('nav > button[aria-expanded]');

describe('the list your garage page under hostile use', () => {
  it('keeps exactly one current entry through repeated and alternating taps', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    for (const index of [3, 3, 0, 5, 5, 2]) {
      entries(page)[index].click();
      await settle(harness);
      expect(current(page)).toHaveLength(1);
    }
    expect(current(page)).toEqual(['3 Prețuri']);
    expect(page.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('does nothing on Escape while the list is closed', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    const heading = page.querySelector('h1') as HTMLElement;
    heading.setAttribute('tabindex', '-1');
    heading.focus();

    heading.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle(harness);

    expect(bar(page)?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(heading);
    expect(scrolls).toEqual([]);
  });

  it('keeps the bar text out of any live region', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    entries(page)[2].click();
    await settle(harness);

    const live = [
      ...page.querySelectorAll('[aria-live], [role="status"], [role="alert"]'),
    ];
    expect(live.map((element) => element.className)).toEqual(['note']);
    expect(live[0].textContent).toBe('');
    expect(bar(page)?.closest('[aria-live]')).toBeNull();
  });

  it('stays open and follows the scroll while the list is open', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    bar(page)?.click();
    await settle(harness);

    tops = [-2000, -1000, -10, 990, 1990, 2990];
    window.dispatchEvent(new Event('scroll'));
    await settle(harness);

    expect(bar(page)?.getAttribute('aria-expanded')).toBe('true');
    expect(text(bar(page))).toBe('3 / 6 · Prețuri');
  });
});
