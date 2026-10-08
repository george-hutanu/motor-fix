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

async function open(path: string, reduced = false) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: ListYourGarage, path: ':lang/list-your-garage' },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: REDUCED_MOTION, useValue: signal(reduced) },
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
const ended = () => window.dispatchEvent(new Event('scrollend'));
const scrolled = async (harness: RouterTestingHarness, to: number[]) => {
  tops = to;
  window.dispatchEvent(new Event('scroll'));
  await settle(harness);
};
const FLIGHT = [990, 1990, 2990, 3990, 4990, 5990];
const AT_STEP_3 = [-2000, -1000, -10, 990, 1990, 2990];
const FOURTH = '4 Mecanici · opțional';

async function withoutScrollEnd(run: () => Promise<void>) {
  const own = Object.getOwnPropertyDescriptor(window, 'onscrollend');
  delete (window as { onscrollend?: unknown }).onscrollend;
  try {
    await run();
  } finally {
    jest.useRealTimers();
    if (own) Object.defineProperty(window, 'onscrollend', own);
  }
}

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

    expect(
      page
        .querySelector('nav')
        ?.querySelector('[aria-live], [role="status"], [role="alert"]'),
    ).toBeNull();
    expect(page.querySelector('.sections > p.note')?.textContent).toBe('');
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

describe('a jump to a step under hostile timing', () => {
  it('replaces the first jump with the second and releases both on one scroll end', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    entries(page)[3].click();
    await scrolled(harness, FLIGHT);
    entries(page)[1].click();
    await scrolled(harness, AT_STEP_3);
    expect(current(page)).toEqual(['2 Mărci']);

    ended();
    await settle(harness);
    expect(current(page)).toEqual(['2 Mărci']);
    await scrolled(harness, AT_STEP_3);
    expect(current(page)).toEqual(['3 Prețuri']);
  });

  it('counts the quiet time from the second jump when the first one is still flying', async () => {
    await withoutScrollEnd(async () => {
      const { harness, page } = await open('/ro/list-your-garage');
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });

      entries(page)[3].click();
      await jest.advanceTimersByTimeAsync(100);
      await scrolled(harness, FLIGHT);
      await jest.advanceTimersByTimeAsync(100);
      entries(page)[1].click();
      await jest.advanceTimersByTimeAsync(120);
      await scrolled(harness, AT_STEP_3);
      expect(current(page)).toEqual(['2 Mărci']);

      await jest.advanceTimersByTimeAsync(200);
      await scrolled(harness, AT_STEP_3);
      expect(current(page)).toEqual(['3 Prețuri']);
    });
  });

  it('does not change the current step when the window is resized during the hold', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    entries(page)[3].click();
    await settle(harness);
    window.dispatchEvent(new Event('resize'));
    await settle(harness);
    expect(current(page)).toEqual([FOURTH]);

    await scrolled(harness, AT_STEP_3);
    window.dispatchEvent(new Event('resize'));
    await settle(harness);
    expect(current(page)).toEqual([FOURTH]);

    ended();
    await scrolled(harness, AT_STEP_3);
    expect(current(page)).toEqual(['3 Prețuri']);
  });

  it('holds the tapped step through an immediate jump under reduced motion, then follows after the end', async () => {
    const { harness, page } = await open('/ro/list-your-garage', true);

    entries(page)[3].click();
    await scrolled(harness, AT_STEP_3);
    expect(scrolls).toEqual([{ behavior: 'auto', block: 'start' }]);
    expect(current(page)).toEqual([FOURTH]);

    ended();
    await scrolled(harness, AT_STEP_3);
    expect(current(page)).toEqual(['3 Prețuri']);
  });

  it('makes the last step current at once and follows the next scroll when the page already sits at its end', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 8000 - window.innerHeight,
    });
    tops = [-7000, -6000, -5000, -4000, -3000, 300];

    entries(page)[5].click();
    await settle(harness);
    expect(current(page)).toEqual([text(entries(page)[5])]);

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    await scrolled(harness, AT_STEP_3);
    expect(current(page)).toEqual(['3 Prețuri']);
  });

  it('holds nothing for a heading less than a pixel from the line, and holds for one a pixel away', async () => {
    const near = await open('/ro/list-your-garage');
    tops = [-1000, 0.9, 1000, 2000, 3000, 4000];
    entries(near.page)[1].click();
    await scrolled(near.harness, AT_STEP_3);
    expect(current(near.page)).toEqual(['3 Prețuri']);
    TestBed.resetTestingModule();

    const far = await open('/ro/list-your-garage');
    tops = [-1000, 1, 1000, 2000, 3000, 4000];
    entries(far.page)[1].click();
    await scrolled(far.harness, AT_STEP_3);
    expect(current(far.page)).toEqual(['2 Mărci']);
  });

  it('ignores a scroll end that arrives with no jump, and does not release a later jump early', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    ended();
    await settle(harness);
    expect(current(page)).toHaveLength(1);
    expect(current(page)[0]).toMatch(/^1 /);

    entries(page)[3].click();
    await scrolled(harness, AT_STEP_3);
    expect(current(page)).toEqual([FOURTH]);
  });

  it('follows the owner from the first scroll after a scroll end with no jump', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    ended();
    ended();
    await scrolled(harness, AT_STEP_3);

    expect(current(page)).toEqual(['3 Prețuri']);
  });

  it('keeps the hold through a long gap while the browser says when scrolls end', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      entries(page)[3].click();
      await jest.advanceTimersByTimeAsync(2000);
      await scrolled(harness, FLIGHT);
      await jest.advanceTimersByTimeAsync(2000);
      await scrolled(harness, AT_STEP_3);

      expect(current(page)).toEqual([FOURTH]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases the hold after a flight that stops, whatever its length, when only the timer stands in', async () => {
    await withoutScrollEnd(async () => {
      const { harness, page } = await open('/ro/list-your-garage');
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });

      entries(page)[3].click();
      for (let i = 0; i < 30; i++) {
        await jest.advanceTimersByTimeAsync(100);
        await scrolled(harness, i % 2 ? FLIGHT : AT_STEP_3);
        expect(current(page)).toEqual([FOURTH]);
      }
      await jest.advanceTimersByTimeAsync(151);
      await scrolled(harness, AT_STEP_3);
      expect(current(page)).toEqual(['3 Prețuri']);
    });
  });

  it('runs no timer after the page is destroyed in the middle of a jump', async () => {
    await withoutScrollEnd(async () => {
      const { harness, page } = await open('/ro/list-your-garage');
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });

      entries(page)[3].click();
      await scrolled(harness, FLIGHT);
      harness.fixture.destroy();

      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
