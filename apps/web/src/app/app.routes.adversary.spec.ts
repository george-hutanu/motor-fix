import { PendingTasks, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  I18n,
  LanguageChoice,
  provideRememberedLanguage,
} from '@motor-fix/i18n';

import { provideLanguageAddresses, SITE_ORIGIN } from './addresses';
import { routes } from './app.routes';

function setUp(extra: object[] = []) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideLanguageAddresses(),
      provideRememberedLanguage(),
      { provide: SITE_ORIGIN, useValue: 'https://motorfix.ro' },
      ...extra,
    ],
  });
}

async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  }
}

async function go(harness: RouterTestingHarness, address: string) {
  await harness.navigateByUrl(address);
  await settle(harness);
}

async function otherTab(harness: RouterTestingHarness, newValue: string) {
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'mf.lang', newValue }),
  );
  await settle(harness);
}

const url = () => TestBed.inject(Router).url;
const lang = () => document.documentElement.lang;
const text = (harness: RouterTestingHarness) =>
  harness.routeNativeElement?.textContent ?? '';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  localStorage.clear();
  setUp();
});

describe('not-found page of an unknown prefix', () => {
  it.each(['/de/', '/de/x/y', '/no-such-page', '/DE', '/en-GB', '/ro-RO/x'])(
    'stays Romanian at %s when another tab picks English',
    async (address) => {
      // @traces 468-FR-001
      const harness = RouterTestingHarness.create();
      const h = await harness;
      await go(h, address);

      await otherTab(h, 'en');

      expect(lang()).toBe('ro');
      expect(text(h)).toContain('Pagina nu există');
      expect(url()).toBe(address);
    },
  );

  // @traces 468-FR-001
  it('follows another tab again after ten visits to unknown prefixes have been left', async () => {
    const harness = await RouterTestingHarness.create();
    for (let i = 0; i < 10; i++) {
      await go(harness, `/de${i}`);
      await go(harness, '/ro');
    }

    await otherTab(harness, 'en');

    expect(url()).toBe('/en');
    expect(lang()).toBe('en');
  });

  // @traces 468-FR-001
  it('keeps holding when one unknown prefix gives way to another, and lets go once left for a known one', async () => {
    const harness = await RouterTestingHarness.create();
    await go(harness, '/de');
    await go(harness, '/fr');

    await otherTab(harness, 'en');
    expect(lang()).toBe('ro');
    expect(url()).toBe('/fr');

    await go(harness, '/ro');
    await otherTab(harness, 'en');

    expect(url()).toBe('/en');
  });

  // @traces 468-FR-001
  it('follows another tab on a known-prefix not-found page left for from an unknown one', async () => {
    const harness = await RouterTestingHarness.create();
    await go(harness, '/de');
    await go(harness, '/en/no-such-page');

    await otherTab(harness, 'ro');

    expect(url()).toBe('/ro/no-such-page');
    expect(text(harness)).toContain('Pagina nu există');
  });

  // @traces 468-FR-001
  it('opens Home in the language another tab chose when the page is left through its Home link', async () => {
    const harness = await RouterTestingHarness.create();
    await go(harness, '/de');
    localStorage.setItem('mf.lang', 'en');
    await otherTab(harness, 'en');

    const link = harness.routeNativeElement?.querySelector(
      'a[href="/"]',
    ) as HTMLAnchorElement;
    link.click();
    await settle(harness);
    await sleep(50);
    await settle(harness);

    expect(url()).toBe('/en');
    expect(lang()).toBe('en');
  });

  // @traces 468-FR-001
  it('stays Romanian when the other tab picks English and then Romanian and English again', async () => {
    const harness = await RouterTestingHarness.create();
    await go(harness, '/de');

    for (const value of ['en', 'ro', 'en']) await otherTab(harness, value);

    expect(lang()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).toBeNull();
  });

  // @traces 468-FR-001
  it("does not write the page's Romanian into the remembered language", async () => {
    localStorage.setItem('mf.lang', 'en');
    const harness = await RouterTestingHarness.create();

    await go(harness, '/de');

    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  // @traces 468-FR-001
  it('leaves the choice of the next visit to / the remembered language after an own tap and a hold', async () => {
    const harness = await RouterTestingHarness.create();
    await go(harness, '/de');
    await TestBed.inject(LanguageChoice).pick('en');
    await settle(harness);

    expect(url()).toBe('/de');
    expect(TestBed.inject(I18n).language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });
});

describe('first visit to /', () => {
  // @traces 468-FR-002
  it('moves to the remembered language with the query kept even while a task stays pending', async () => {
    localStorage.setItem('mf.lang', 'en');
    await RouterTestingHarness.create();
    const release = TestBed.inject(PendingTasks).add();
    try {
      await TestBed.inject(Router).navigateByUrl('/?from=ad#top');
      await sleep(2_200);

      expect(url()).toBe('/en?from=ad#top');
    } finally {
      release();
    }
  });

  // @traces 468-FR-002
  it('lets a tap made before the bound win while a task stays pending', async () => {
    await RouterTestingHarness.create();
    const release = TestBed.inject(PendingTasks).add();
    try {
      await TestBed.inject(Router).navigateByUrl('/');
      await TestBed.inject(LanguageChoice).pick('en');
      await sleep(2_200);

      expect(url()).toBe('/en');
    } finally {
      release();
    }
  });

  // @traces 468-FR-002
  it('stays at / for a good part of the bound while a task stays pending', async () => {
    await RouterTestingHarness.create();
    const release = TestBed.inject(PendingTasks).add();
    try {
      await TestBed.inject(Router).navigateByUrl('/');
      await sleep(1_000);

      expect(url()).toBe('/');
    } finally {
      release();
    }
  });

  // @traces 468-FR-002
  it('moves at once, well before the bound, when the app is stable', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    await settle(harness);

    expect(url()).toBe('/ro');
  });

  // @traces 468-FR-002
  it('does not pull a visitor who left / for another page back to the language address when the bound passes', async () => {
    await RouterTestingHarness.create();
    const release = TestBed.inject(PendingTasks).add();
    try {
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/');
      await router.navigateByUrl('/de/page');
      await sleep(2_200);

      expect(url()).toBe('/de/page');
    } finally {
      release();
    }
  });

  // @traces 468-FR-002
  it('replaces the history entry on the move once the bound has passed', async () => {
    await RouterTestingHarness.create();
    const release = TestBed.inject(PendingTasks).add();
    const before = history.length;
    try {
      await TestBed.inject(Router).navigateByUrl('/');
      await sleep(2_200);

      expect(url()).toBe('/ro');
      expect(history.length).toBeLessThanOrEqual(before + 1);
    } finally {
      release();
    }
  });
});

describe('cockpit route guard', () => {
  // @traces 468-FR-003
  it('has the cockpit texts when the route matches even while another task stays pending', async () => {
    const harness = await RouterTestingHarness.create();
    const release = TestBed.inject(PendingTasks).add();
    try {
      expect(await TestBed.inject(Router).navigateByUrl('/cockpit')).toBe(true);
      expect(TestBed.inject(I18n).t('cockpit.dialogTitle')).toBe(
        'Programare confirmată',
      );
    } finally {
      release();
      await settle(harness);
    }
  });

  // @traces 468-FR-003
  it('leaves the router able to navigate when the texts fail to load', async () => {
    const harness = await RouterTestingHarness.create();
    const i18n = TestBed.inject(I18n);
    jest.spyOn(i18n, 'enter').mockRejectedValueOnce(new Error('offline'));

    await TestBed.inject(Router)
      .navigateByUrl('/cockpit')
      .catch(() => false);
    await go(harness, '/ro');

    expect(url()).toBe('/ro');
  });

  // @traces 468-FR-003
  it('waits for the cockpit texts on the server too', async () => {
    TestBed.resetTestingModule();
    setUp([{ provide: PLATFORM_ID, useValue: 'server' }]);
    await RouterTestingHarness.create();
    const i18n = TestBed.inject(I18n);
    const enter = i18n.enter.bind(i18n);
    const spy = jest
      .spyOn(i18n, 'enter')
      .mockImplementation((area) => sleep(30).then(() => enter(area)));

    expect(await TestBed.inject(Router).navigateByUrl('/cockpit')).toBe(true);

    expect(spy).toHaveBeenCalledWith('cockpit');
    expect(i18n.t('cockpit.dialogTitle')).toBe('Programare confirmată');
  });
});
