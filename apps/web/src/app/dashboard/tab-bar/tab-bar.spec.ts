import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { I18n } from '@motor-fix/i18n';

import { DashboardTabBar } from './tab-bar';
import { allowedViews, DASHBOARDS } from '../views';

@Component({ template: '' })
class Blank {}

@Component({
  imports: [DashboardTabBar],
  template: `<mf-dashboard-tab-bar base="/app/garage" [views]="views" name="shell.frame.bar.garage" />`,
})
class Host {
  readonly views = DASHBOARDS.garage.views.slice(0, 4);
}

let scrolled: jest.Mock;

async function open(url: string) {
  scrolled = jest.fn();
  Element.prototype.scrollIntoView = scrolled;
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
const current = (element: HTMLElement) =>
  tabs(element)
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.textContent?.trim());

describe('DashboardTabBar', () => {
  it('shows one tab per view, in order, with its short label and its address', async () => {
    const { element } = await open('/app/garage');

    expect(tabs(element).map((a) => a.textContent?.trim())).toEqual([
      'Panou',
      'Cereri',
      'Program',
      'Mecanici',
    ]);
    expect(tabs(element).map((a) => a.getAttribute('href'))).toEqual([
      '/app/garage',
      '/app/garage/requests',
      '/app/garage/schedule',
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
    scrolled.mockClear();

    await harness.navigateByUrl('/app/garage/team');
    harness.detectChanges();
    await harness.fixture.whenStable();

    expect(scrolled).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
    expect(scrolled.mock.contexts.at(-1)).toBe(tabs(element)[3]);
  });

  it('turns its labels and its name English', async () => {
    const { element, harness } = await open('/app/garage');
    await TestBed.inject(I18n).use('en');
    harness.detectChanges();

    expect(tabs(element).map((a) => a.textContent?.trim())).toEqual([
      'Home',
      'Requests',
      'Schedule',
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
  readonly counts = signal<{ garagesWaiting?: number }>({});
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
    ).toEqual(['Panou', 'Service‑uri', 'Utilizatori', 'Setări']);
  });

  it('puts the count on the garages tab and on no other', async () => {
    const { element } = await openAdmin(4);

    expect(chips(element)).toEqual([null, '4', null, null]);
    expect(tabs(element)[1]?.getAttribute('aria-label')).toBe(
      'Service‑uri, 4 în așteptare',
    );
  });

  it('shows no count at zero, nor while the count is unknown', async () => {
    const { element, harness, host } = await openAdmin(0);

    expect(chips(element)).toEqual([null, null, null, null]);
    expect(tabs(element)[1]?.getAttribute('aria-label')).toBeNull();
    host.counts.set({});
    harness.detectChanges();
    expect(chips(element)).toEqual([null, null, null, null]);
  });

  it('caps the chip at 99+ and keeps the full count in the name', async () => {
    const { element } = await openAdmin(120);

    expect(chips(element)[1]).toBe('99+');
    expect(tabs(element)[1]?.getAttribute('aria-label')).toBe(
      'Service‑uri, 120 în așteptare',
    );
  });

  it('shows 99 itself in the chip', async () => {
    const { element } = await openAdmin(99);

    expect(chips(element)[1]).toBe('99');
  });

  it('names the counted tab in English', async () => {
    const { element, harness } = await openAdmin(1);
    await TestBed.inject(I18n).use('en');
    harness.detectChanges();

    expect(tabs(element)[1]?.getAttribute('aria-label')).toBe(
      'Garages, 1 waiting',
    );
  });
});
