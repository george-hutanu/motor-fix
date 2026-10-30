import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { I18n } from '@motor-fix/i18n';
import { OpenSheets } from '@motor-fix/overlays';

import { DashboardTabBar } from './tab-bar';
import { spoken } from '../../spoken.testing';
import { allowedViews, DASHBOARDS } from '../views';

@Component({ template: '' })
class Blank {}

@Component({
  imports: [DashboardTabBar],
  template: `<mf-dashboard-tab-bar base="/app/garage" [views]="views()" name="shell.frame.bar.garage" />`,
})
class Host {
  readonly views = signal(DASHBOARDS.garage.views.slice(0, 5));
}

let scrolled: jest.Mock;

// jsdom lays nothing out: the bar is 199.5 px wide (a phone's fractional
// pixels) and each tab 80 px, placed by the bar's own horizontal scroll.
function layout(this: Element): DOMRect {
  const nav = this.closest('nav');
  if (this.tagName === 'NAV') return { left: 0, right: 199.5 } as DOMRect;
  const index = nav
    ? [...nav.querySelectorAll('a')].indexOf(this as HTMLAnchorElement)
    : -1;
  const left = index * 80 - (nav?.scrollLeft ?? 0);
  return { left, right: left + 80 } as DOMRect;
}

async function open(url: string) {
  scrolled = jest.fn();
  Element.prototype.scrollIntoView = scrolled;
  jest
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(layout);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: [{ component: Blank, path: '**' }],
          component: Host,
          path: 'app/garage',
        },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  return { element: harness.routeNativeElement as HTMLElement, harness };
}

const tabs = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLAnchorElement>('mf-dashboard-tab-bar nav a'),
];
const bar = (element: HTMLElement) =>
  element.querySelector('mf-dashboard-tab-bar nav') as HTMLElement;
const current = (element: HTMLElement) =>
  tabs(element)
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.textContent?.trim());

// @traces 248-FR-007
describe('DashboardTabBar', () => {
  it('shows one tab per view, in order, with its short label and its address', async () => {
    const { element } = await open('/app/garage');

    expect(tabs(element).map((a) => a.textContent?.trim())).toEqual([
      'Panou',
      'Cereri',
      'Program',
      'Lucrări',
      'Mecanici',
    ]);
    expect(tabs(element).map((a) => a.getAttribute('href'))).toEqual([
      '/app/garage',
      '/app/garage/requests',
      '/app/garage/schedule',
      '/app/garage/jobs',
      '/app/garage/team',
    ]);
  });

  it('is a navigation landmark named after the dashboard', async () => {
    const { element } = await open('/app/garage');

    const nav = element.querySelector('mf-dashboard-tab-bar nav');
    expect(nav?.getAttribute('aria-label')).toBe('Panou service');
  });

  it('marks only the dashboard tab current on the dashboard address', async () => {
    const { element } = await open('/app/garage');

    expect(current(element)).toEqual(['Panou']);
  });

  it('marks the open view current, its sub-pages included', async () => {
    const { element, harness } = await open('/app/garage/schedule');

    expect(current(element)).toEqual(['Program']);
    await harness.navigateByUrl('/app/garage/team/mihai');
    harness.detectChanges();
    expect(current(element)).toEqual(['Mecanici']);
  });

  it('scrolls the current tab into sight without moving the page', async () => {
    const { element, harness } = await open('/app/garage');

    await harness.navigateByUrl('/app/garage/team');
    harness.detectChanges();
    await harness.fixture.whenStable();

    // Mecanici, the fifth tab, spans 320-400 px: the bar scrolls by its own
    // overhang, rounded up to a whole pixel so no sliver stays hidden.
    expect(bar(element).scrollLeft).toBe(201);
  });

  it('scrolls the bar back when the current tab sits before its view', async () => {
    const { element, harness } = await open('/app/garage/team');
    expect(bar(element).scrollLeft).toBe(201);

    await harness.navigateByUrl('/app/garage');
    harness.detectChanges();
    await harness.fixture.whenStable();

    expect(bar(element).scrollLeft).toBe(0);
  });

  // Chrome's scrollIntoView also moves where Tab starts from, so the first
  // Tab on a dashboard skipped the skip link for the tab after the current.
  it('leaves where the keyboard starts from at the top of the page', async () => {
    const { harness } = await open('/app/garage');

    await harness.navigateByUrl('/app/garage/team');
    harness.detectChanges();
    await harness.fixture.whenStable();

    expect(scrolled).not.toHaveBeenCalled();
  });

  it('keeps the current tab in sight when a tab before it arrives later', async () => {
    const { element, harness } = await open('/app/garage/team');
    const host = harness.fixture.debugElement.query(
      (node) => node.componentInstance instanceof Host,
    ).componentInstance as Host;
    const all = host.views();
    host.views.set(all.filter((view) => view.path !== 'schedule'));
    harness.detectChanges();
    await harness.fixture.whenStable();
    // Scrolled just far enough to show Mecanici as the fourth tab.
    bar(element).scrollLeft = 120;

    // A garage's feature switches load after the bar marked its tab: the
    // schedule tab lands before Mecanici and would push it out of sight.
    host.views.set(all);
    harness.detectChanges();
    await harness.fixture.whenStable();

    expect(bar(element).scrollLeft).toBe(201);
  });

  // @traces 1127-FR-004
  it('turns invisible while a bottom sheet is open and keeps its space', async () => {
    const { element, harness } = await open('/app/garage');
    const bar = element.querySelector<HTMLElement>('mf-dashboard-tab-bar');
    const sheets = TestBed.inject(OpenSheets);

    expect(bar?.style.visibility).toBe('');
    sheets.opened();
    sheets.opened();
    harness.detectChanges();
    expect(bar?.style.visibility).toBe('hidden');
    sheets.closed();
    harness.detectChanges();
    expect(bar?.style.visibility).toBe('hidden');
    sheets.closed();
    harness.detectChanges();
    expect(bar?.style.visibility).toBe('');
  });

  it('turns its labels and its name English', async () => {
    const { element, harness } = await open('/app/garage');
    await TestBed.inject(I18n).use('en');
    harness.detectChanges();

    expect(tabs(element).map((a) => a.textContent?.trim())).toEqual([
      'Home',
      'Requests',
      'Schedule',
      'Jobs',
      'Team',
    ]);
    expect(
      element
        .querySelector('mf-dashboard-tab-bar nav')
        ?.getAttribute('aria-label'),
    ).toBe('Garage dashboard');
  });
});

@Component({
  imports: [DashboardTabBar],
  template: `<mf-dashboard-tab-bar base="/app/admin" [views]="views" [counts]="counts()" name="shell.frame.bar.admin" />`,
})
class AdminHost {
  readonly views = allowedViews('admin', [
    'admin.garages',
    'admin.users',
    'admin.reviews',
    'admin.catalogue',
    'admin.settings',
  ]);
  readonly counts = signal<{
    garagesWaiting?: number;
    reportsPending?: number;
  }>({});
}

async function openAdmin(garagesWaiting?: number) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: [{ component: Blank, path: '**' }],
          component: AdminHost,
          path: 'app/admin',
        },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  const host = (await harness.navigateByUrl(
    '/app/admin',
    AdminHost,
  )) as AdminHost;
  host.counts.set(garagesWaiting === undefined ? {} : { garagesWaiting });
  harness.detectChanges();
  const element = harness.routeNativeElement as HTMLElement;
  return { element, harness, host };
}

const chips = (element: HTMLElement) =>
  tabs(element).map(
    (a) => a.querySelector('.chip')?.textContent?.trim() ?? null,
  );

describe('DashboardTabBar on the admin dashboard', () => {
  it('shows the released admin views with their short labels', async () => {
    const { element } = await openAdmin();

    expect(
      tabs(element).map((a) => a.querySelector('.label')?.textContent?.trim()),
    ).toEqual([
      'Panou',
      'Service‑uri',
      'Utilizatori',
      'Raportate',
      'Mărci',
      'Propuse',
      'Jurnal',
      'Setări',
    ]);
  });

  it('puts the count on the garages tab and on no other', async () => {
    const { element } = await openAdmin(4);

    expect(chips(element)).toEqual([
      null,
      '4',
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(tabs(element)[1]?.hasAttribute('aria-label')).toBe(false);
    expect(spoken(tabs(element)[1])).toBe('Service‑uri 4 în așteptare');
  });

  it('shows no count at zero, nor while the count is unknown', async () => {
    const { element, harness, host } = await openAdmin(0);

    expect(chips(element)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(tabs(element)[1]?.hasAttribute('aria-label')).toBe(false);
    expect(spoken(tabs(element)[1])).not.toMatch(/așteptare|waiting/);
    host.counts.set({});
    harness.detectChanges();
    expect(chips(element)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  // @traces 1389-reported-reviews-admin-FR-005
  it('puts the reported reviews count on its own tab', async () => {
    const { element, harness, host } = await openAdmin();
    host.counts.set({ reportsPending: 2 });
    harness.detectChanges();

    expect(chips(element)).toEqual([
      null,
      null,
      null,
      '2',
      null,
      null,
      null,
      null,
    ]);
    expect(spoken(tabs(element)[3])).toBe('Raportate 2 în așteptare');
  });

  it('caps the chip at 99+ and keeps the full count in the name', async () => {
    const { element } = await openAdmin(120);

    expect(chips(element)[1]).toBe('99+');
    expect(tabs(element)[1]?.hasAttribute('aria-label')).toBe(false);
    expect(spoken(tabs(element)[1])).toBe('Service‑uri 120 în așteptare');
  });

  it('shows 99 itself in the chip', async () => {
    const { element } = await openAdmin(99);

    expect(chips(element)[1]).toBe('99');
  });

  it('names the counted tab in English', async () => {
    const { element, harness } = await openAdmin(1);
    await TestBed.inject(I18n).use('en');
    harness.detectChanges();

    expect(tabs(element)[1]?.hasAttribute('aria-label')).toBe(false);
    expect(spoken(tabs(element)[1])).toBe('Garages 1 waiting');
  });
});

describe('DashboardTabBar spacing', () => {
  it('pads and spaces the bar, its tabs and their chips on the 4 px grid', () => {
    const css = readFileSync(join(__dirname, 'tab-bar.css'), 'utf8');
    const spacing = [...css.matchAll(/(?:padding|gap): ([^;]+);/g)]
      .map((m) => m[1])
      .join(' ');

    expect(spacing).not.toBe('');
    for (const px of spacing.matchAll(/(\d+(?:\.\d+)?)px/g)) {
      expect(`${px[0]} ${Number(px[1]) % 4}`).toBe(`${px[0]} 0`);
    }
  });

  // A phone reads its tab names and counts at the body size, never the 12 px label size.
  it('sets every tab name and count at the body size', () => {
    const css = readFileSync(join(__dirname, 'tab-bar.css'), 'utf8');
    const sizes = [...css.matchAll(/font-size: ([^;]+);/g)].map((m) => m[1]);

    expect(sizes.length).toBeGreaterThan(0);
    expect(new Set(sizes)).toEqual(new Set(['var(--mf-size-body)']));
  });

  // Six tabs at the body size fit a 390 px phone: each takes its name's width
  // plus 4 px a side, never under the 44 px target.
  it('keeps each tab to its name plus 4 px a side, at least 44 px wide', () => {
    const css = readFileSync(join(__dirname, 'tab-bar.css'), 'utf8');
    // The contact entry is a button drawn as the tabs, so it shares the rule.
    const tab = /\na,\nbutton \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(tab).toContain('min-width: 44px;');
    expect(tab).toContain('padding: 0 4px;');
  });
});
