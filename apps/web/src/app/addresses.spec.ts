import { PendingTasks, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type PartialMatchRouteSnapshot,
  provideRouter,
  type Route,
  Router,
  RoutesRecognized,
  UrlSegment,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HealthService } from '@motor-fix/data-access';
import {
  I18n,
  LanguageChoice,
  provideRememberedLanguage,
} from '@motor-fix/i18n';

import {
  alternates,
  PUBLIC_PATHS,
  provideLanguageAddresses,
  SITE_ORIGIN,
  toLanguageAddress,
} from './addresses';
import { routes } from './app.routes';
import { Home } from './home/home';

const ORIGIN = 'https://motorfix.ro';

function setUp() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideLanguageAddresses(),
      { provide: SITE_ORIGIN, useValue: ORIGIN },
    ],
  });
}

function serverSetUp() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideLanguageAddresses(),
      { provide: SITE_ORIGIN, useValue: ORIGIN },
      { provide: PLATFORM_ID, useValue: 'server' },
      {
        provide: HealthService,
        useValue: { healthControllerReady: () => Promise.reject() },
      },
    ],
  });
}

async function open(url: string) {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle(harness);
  return harness;
}

async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  }
}

const url = () => TestBed.inject(Router).url;
const lang = () => document.documentElement.lang;
const text = (harness: RouterTestingHarness) =>
  harness.routeNativeElement?.textContent ?? '';
const href = (selector: string) =>
  document.head.querySelector(selector)?.getAttribute('href');
const robots = () =>
  [...document.head.querySelectorAll('meta[name="robots"]')].map((m) =>
    m.getAttribute('content'),
  );

const LANDMARKS = 'header, main, nav, footer, aside, section[aria-label]';

// One main, at the top level, holding Home; every other part of the frame
// that holds anything in a landmark of its own, the site bar holding sign-in
// and the language switch. The consent bar is empty on the server, and the
// toaster until a toast, which then shows in a labelled section of its own.
function expectLandmarks(harness: RouterTestingHarness, signIn: string) {
  const root = harness.fixture.nativeElement as HTMLElement;
  const mains = root.querySelectorAll('main');
  expect(mains).toHaveLength(1);
  const main = mains[0];
  expect(main.parentElement?.closest(LANDMARKS)).toBeNull();
  expect(main.querySelector('h1')?.textContent).toContain('MotorFix');
  expect(main.textContent).toContain('PostgreSQL');

  const frame = root.querySelector('mf-public-frame');
  expect(frame).not.toBeNull();
  for (const part of Array.from(frame?.children ?? [])) {
    if (part.tagName === 'MF-CONSENT-BAR' || part.tagName === 'HLM-TOASTER')
      continue;
    const landmark = part.matches(LANDMARKS)
      ? part
      : part.querySelector(LANDMARKS);
    expect(landmark).not.toBeNull();
  }
  const banners = frame?.querySelectorAll(':scope > header') ?? [];
  expect(banners).toHaveLength(1);
  expect(banners[0].querySelector('button')?.textContent).toContain(signIn);
  expect(banners[0].querySelector('[role="group"]')).not.toBeNull();
}

// The pages these tests open are lazy routes. The first navigation to each one
// transforms its whole component tree, which under a loaded machine took more
// than a test's 5 s budget (list your garage). Loading them once up front keeps
// that one-off cost out of the tests, which then time only the navigation.
beforeAll(
  () =>
    Promise.all([
      import('./public/frame/frame'),
      import('./public/results/results'),
      import('./public/list-your-garage/list-your-garage'),
      import('./public/review-rules/review-rules'),
    ]),
  120_000,
);

beforeEach(() => {
  localStorage.clear();
  document.head
    .querySelectorAll('link[rel="canonical"], link[hreflang], meta[name]')
    .forEach((element) => {
      element.remove();
    });
});

describe('language addresses', () => {
  beforeEach(setUp);

  it('opens /en in English and remembers English, over a remembered Romanian', async () => {
    localStorage.setItem('mf.lang', 'ro');

    const harness = await open('/en');

    expect(lang()).toBe('en');
    expect(text(harness)).toContain('version unknown');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('gives /ro one top-level main around Home, and the sign-in bar a header', async () => {
    const harness = await open('/ro');

    expectLandmarks(harness, 'Autentificare');
  });

  it.each([
    ['another public page', '/ro/garages'],
    ['a not-found page', '/ro/no-such-page'],
  ])('keeps one main, never nested, on %s', async (_page, address) => {
    const harness = await open(address);
    const root = harness.fixture.nativeElement as HTMLElement;

    expect(root.querySelectorAll('main')).toHaveLength(1);
    expect(root.querySelectorAll('main main')).toHaveLength(0);
  });

  it('opens /ro in Romanian', async () => {
    const harness = await open('/ro');

    expect(lang()).toBe('ro');
    expect(text(harness)).toContain('versiune necunoscută');
  });

  it('moves the address to the new language, keeping the rest, with no new history entry', async () => {
    const harness = await open('/ro?from=search#top');
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigateByUrl');

    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(url()).toBe('/en?from=search#top');
    expect(navigate).toHaveBeenCalledWith(expect.anything(), {
      replaceUrl: true,
    });
    expect(text(harness)).toContain('version unknown');
  });

  it('moves a not-found address under a known prefix in place', async () => {
    const harness = await open('/ro/no-such-page');

    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(url()).toBe('/en/no-such-page');
  });

  it('moves the address for a language change that lands while a page is still opening', async () => {
    const harness = await open('/ro');
    const router = TestBed.inject(Router);
    let open_: () => void = () => undefined;
    const opened = new Promise<boolean>((resolve) => {
      open_ = () => resolve(true);
    });
    const prefix = routes.find((route) => route.path === ':lang');
    router.resetConfig(
      routes.map((route) =>
        route === prefix
          ? {
              ...route,
              children: [
                ...(route.children ?? []),
                { canActivate: [() => opened], component: Home, path: 'slow' },
              ],
            }
          : route,
      ),
    );

    const navigation = router.navigateByUrl('/ro/slow');
    await new Promise((resolve) => setTimeout(resolve));
    await TestBed.inject(I18n).use('en');
    // whenStable would wait for the navigation the gate is holding.
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    open_();
    await navigation;
    await settle(harness);

    expect(url()).toBe('/en/slow');
    expect(href('link[rel="canonical"]')).toBe(`${ORIGIN}/en/slow`);
  });

  it('leaves an address without a language prefix as it is', async () => {
    const harness = await open('/de');

    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(url()).toBe('/de');
  });

  it('sends / to the remembered language in the browser, keeping the query', async () => {
    localStorage.setItem('mf.lang', 'en');

    await open('/?from=ad');

    expect(url()).toBe('/en?from=ad');
    expect(lang()).toBe('en');
  });

  it('sends / to Romanian when nothing is remembered', async () => {
    await open('/');

    expect(url()).toBe('/ro');
  });

  it('keeps the first page at / until the app is stable, and a language picked meanwhile wins', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');

    expect(url()).toBe('/');

    await TestBed.inject(LanguageChoice).pick('en');
    await settle(harness);

    expect(url()).toBe('/en');
    expect(lang()).toBe('en');
  });

  it('gives a public page its canonical and hreflang links', async () => {
    await open('/en');

    expect(href('link[rel="canonical"]')).toBe(`${ORIGIN}/en/`);
    expect(href('link[hreflang="ro"]')).toBe(`${ORIGIN}/ro/`);
    expect(href('link[hreflang="en"]')).toBe(`${ORIGIN}/en/`);
    expect(href('link[hreflang="x-default"]')).toBe(`${ORIGIN}/ro/`);
    expect(robots()).toEqual([]);
  });

  it('gives the list your garage page one address per language, with its search engine links', async () => {
    await open('/ro/list-your-garage');

    expect(url()).toBe('/ro/list-your-garage');
    expect(PUBLIC_PATHS).toContain('list-your-garage');
    expect(href('link[rel="canonical"]')).toBe(`${ORIGIN}/ro/list-your-garage`);
    expect(href('link[hreflang="en"]')).toBe(`${ORIGIN}/en/list-your-garage`);
    expect(href('link[hreflang="x-default"]')).toBe(
      `${ORIGIN}/ro/list-your-garage`,
    );
    expect(robots()).toEqual([]);
  });

  // @traces 182-FR-003
  it('gives the review rules one address per language, with its search engine links', async () => {
    await open('/en/review-rules');

    expect(url()).toBe('/en/review-rules');
    expect(PUBLIC_PATHS).toContain('review-rules');
    expect(href('link[rel="canonical"]')).toBe(`${ORIGIN}/en/review-rules`);
    expect(href('link[hreflang="ro"]')).toBe(`${ORIGIN}/ro/review-rules`);
    expect(href('link[hreflang="x-default"]')).toBe(
      `${ORIGIN}/ro/review-rules`,
    );
    expect(robots()).toEqual([]);
  });

  it('marks a page that is not public noindex, and replaces the tags on the next page', async () => {
    const harness = await open('/de');

    expect(robots()).toEqual(['noindex']);
    expect(href('link[rel="canonical"]')).toBeUndefined();
    expect(document.head.querySelectorAll('link[hreflang]')).toHaveLength(0);

    await harness.navigateByUrl('/ro');
    await settle(harness);

    expect(robots()).toEqual([]);
    expect(
      document.head.querySelectorAll('link[rel="canonical"]'),
    ).toHaveLength(1);
    expect(href('link[rel="canonical"]')).toBe(`${ORIGIN}/ro/`);
  });

  it('shows the not-found page in Romanian for an unknown language prefix', async () => {
    const harness = await open('/de');

    expect(lang()).toBe('ro');
    expect(text(harness)).toContain('Pagina nu există');
  });

  it('keeps the not-found page of an unknown prefix Romanian when English is remembered', async () => {
    TestBed.configureTestingModule({
      providers: [provideRememberedLanguage()],
    });
    localStorage.setItem('mf.lang', 'en');

    const harness = await open('/de');

    expect(lang()).toBe('ro');
    expect(text(harness)).toContain('Pagina nu există');
  });

  describe('with another tab choosing a language', () => {
    beforeEach(() =>
      TestBed.configureTestingModule({
        providers: [provideRememberedLanguage()],
      }),
    );

    const otherTab = async (harness: RouterTestingHarness, value: string) => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'mf.lang', newValue: value }),
      );
      await settle(harness);
    };
    const pressed = (harness: RouterTestingHarness) =>
      [
        ...(harness.routeNativeElement?.querySelectorAll(
          '[aria-pressed="true"]',
        ) ?? []),
      ].map((button) => button.textContent?.trim());

    // @traces 468-FR-001
    it('keeps the not-found page of an unknown prefix Romanian, and the next page follows again', async () => {
      const harness = await open('/de');

      await otherTab(harness, 'en');

      expect(lang()).toBe('ro');
      expect(text(harness)).toContain('Pagina nu există');
      expect(pressed(harness)).toEqual(['RO']);
      expect(url()).toBe('/de');

      await harness.navigateByUrl('/ro');
      await settle(harness);
      await otherTab(harness, 'en');

      expect(url()).toBe('/en');
      expect(lang()).toBe('en');
    });

    // @traces 468-FR-001
    it('keeps English on the not-found page of an unknown prefix after a tap there, whatever another tab chooses', async () => {
      const harness = await open('/de');
      await TestBed.inject(LanguageChoice).pick('en');
      await settle(harness);

      await otherTab(harness, 'ro');

      expect(lang()).toBe('en');
      expect(text(harness)).toContain('Page not found');
      expect(url()).toBe('/de');
    });

    // @traces 468-FR-001
    it('moves a not-found page under a known prefix with another tab', async () => {
      const harness = await open('/en/no-such-page');

      await otherTab(harness, 'ro');

      expect(url()).toBe('/ro/no-such-page');
      expect(lang()).toBe('ro');
    });
  });

  // @traces 468-FR-002
  it('moves a first visit off / within two seconds even while the app never becomes stable', async () => {
    await RouterTestingHarness.create();
    const release = TestBed.inject(PendingTasks).add();
    try {
      await TestBed.inject(Router).navigateByUrl('/');

      expect(url()).toBe('/');

      await new Promise((resolve) => setTimeout(resolve, 2_100));

      expect(url()).toBe('/ro');
    } finally {
      release();
    }
  });

  it('shows the not-found page in the language of a known prefix', async () => {
    const harness = await open('/en/no-such-page');

    expect(lang()).toBe('en');
    expect(text(harness)).toContain('Page not found');
    expect(robots()).toEqual(['noindex']);
  });
});

describe('/ on the server', () => {
  it('renders Home where it is, in Romanian', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });
    localStorage.setItem('mf.lang', 'en');

    const result = TestBed.runInInjectionContext(() =>
      toLanguageAddress(
        {} as Route,
        [] as UrlSegment[],
        {} as PartialMatchRouteSnapshot,
      ),
    );

    expect(result).toBe(true);
    expect(TestBed.inject(I18n).language()).toBe('ro');
  });

  it('renders / in the public frame, with one main around Home and no tab bar', async () => {
    serverSetUp();

    const harness = await open('/');

    expect(url()).toBe('/');
    expectLandmarks(harness, 'Autentificare');
    const root = harness.fixture.nativeElement as HTMLElement;
    expect(root.querySelector('mf-public-tab-bar')).toBeNull();
  });

  it('gives / the canonical and hreflang links of /ro/', async () => {
    serverSetUp();

    await open('/');

    expect(url()).toBe('/');
    expect(href('link[rel="canonical"]')).toBe(`${ORIGIN}/ro/`);
    expect(href('link[hreflang="en"]')).toBe(`${ORIGIN}/en/`);
  });
});

describe('alternates', () => {
  it('builds the absolute address of each language, Romanian as the default', () => {
    expect(alternates(ORIGIN, 'garages/atelier-dinamo')).toEqual({
      en: `${ORIGIN}/en/garages/atelier-dinamo`,
      ro: `${ORIGIN}/ro/garages/atelier-dinamo`,
      'x-default': `${ORIGIN}/ro/garages/atelier-dinamo`,
    });
  });
});

describe('public frame', () => {
  // The site bar grew the frame; loaded on demand, it stays out of the first
  // download, whose budget the production build enforces.
  it.each(['', ':lang'])('loads the frame of "%s" on demand', (path) => {
    const route = routes.find((r) => r.path === path);

    expect(route?.loadComponent).toBeDefined();
    expect(route?.component).toBeUndefined();
  });
});

describe('cockpitTexts', () => {
  beforeEach(setUp);

  // @traces 468-FR-003
  it('holds the cockpit route until its texts have loaded, without waiting for the app to settle', async () => {
    await RouterTestingHarness.create();
    const i18n = TestBed.inject(I18n);
    const router = TestBed.inject(Router);
    const enter = i18n.enter.bind(i18n);
    // A task later than anything the router does before it matches a route.
    jest
      .spyOn(i18n, 'enter')
      .mockImplementation((area) =>
        new Promise((resolve) => setTimeout(resolve)).then(() => enter(area)),
      );
    const atMatch: string[] = [];
    router.events.subscribe((event) => {
      if (event instanceof RoutesRecognized)
        atMatch.push(i18n.t('cockpit.dialogTitle'));
    });

    expect(await router.navigateByUrl('/cockpit')).toBe(true);

    expect(i18n.enter).toHaveBeenCalledWith('cockpit');
    expect(atMatch).toEqual(['Programare confirmată']);
  });
});

// @traces 385-FR-002
describe("the site's origin in the browser", () => {
  afterEach(() =>
    document.head.querySelector('meta[name="mf-site"]')?.remove(),
  );

  it('is the one the server named in the page, never the address bar', () => {
    const tag = document.createElement('meta');
    tag.name = 'mf-site';
    tag.content = 'https://motorfix.ro';
    document.head.append(tag);

    expect(TestBed.inject(SITE_ORIGIN)).toBe('https://motorfix.ro');
  });

  it('falls back to the address bar only on a page the server did not name', () => {
    expect(TestBed.inject(SITE_ORIGIN)).toBe(location.origin);
  });
});
