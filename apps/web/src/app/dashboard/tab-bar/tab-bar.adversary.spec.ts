import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { DashboardTabBar } from './tab-bar';
import { DASHBOARDS, type DashboardView } from '../views';

@Component({ template: '' })
class Blank {}

const views = signal<readonly DashboardView[]>([]);
const base = signal('/app/garage');

@Component({
  imports: [DashboardTabBar],
  template: `<mf-dashboard-tab-bar [base]="base()" [views]="views()" name="shell.frame.bar.garage" />`,
})
class Host {
  readonly base = base;
  readonly views = views;
}

async function open(url: string) {
  Element.prototype.scrollIntoView = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: [{ component: Blank, path: '**' }],
          component: Host,
          path: 'app/garage',
        },
        {
          children: [{ component: Blank, path: '**' }],
          component: Host,
          path: 'app/driver',
        },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  return { element: harness.routeNativeElement as HTMLElement, harness };
}
const links = (e: HTMLElement) => [
  ...e.querySelectorAll<HTMLAnchorElement>('mf-dashboard-tab-bar nav a'),
];
const currentHrefs = (e: HTMLElement) =>
  links(e)
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.getAttribute('href'));

afterEach(() => {
  views.set([]);
  base.set('/app/garage');
});

describe('DashboardTabBar under hostile input', () => {
  it('renders an empty named landmark with no tabs for an empty list', async () => {
    views.set([]);
    const { element } = await open('/app/garage');
    expect(links(element)).toHaveLength(0);
    expect(
      element
        .querySelector('mf-dashboard-tab-bar nav')
        ?.getAttribute('aria-label'),
    ).toBe('Panou service');
  });

  it('renders one tab for a single dashboard view, marked current', async () => {
    views.set(DASHBOARDS.garage.views.slice(0, 1));
    const { element } = await open('/app/garage');
    expect(currentHrefs(element)).toEqual(['/app/garage']);
  });

  it('renders a hundred tabs without dropping any', async () => {
    views.set(
      Array.from({ length: 100 }, (_, i) => ({
        label: 'shell.frame.nav.garage.team',
        path: `p${i}`,
        tab: 'shell.frame.tab.team',
      })),
    );
    const { element } = await open('/app/garage');
    expect(links(element)).toHaveLength(100);
    expect(links(element)[99].getAttribute('href')).toBe('/app/garage/p99');
  });

  it('marks only the dashboard tab current on the dashboard address', async () => {
    views.set(DASHBOARDS.garage.views);
    const { element } = await open('/app/garage');
    expect(currentHrefs(element)).toEqual(['/app/garage']);
  });

  it('marks only the view tab current on a view address', async () => {
    views.set(DASHBOARDS.garage.views);
    const { element } = await open('/app/garage/team');
    expect(currentHrefs(element)).toEqual(['/app/garage/team']);
  });

  it('marks the tab current for a sub-path of its view', async () => {
    views.set(DASHBOARDS.garage.views);
    const { element } = await open('/app/garage/team/5/edit');
    expect(currentHrefs(element)).toEqual(['/app/garage/team']);
  });

  it('scrolls the active tab into sight without scrolling the page', async () => {
    views.set(DASHBOARDS.garage.views);
    const { element } = await open('/app/garage/profile');
    const spy = Element.prototype.scrollIntoView as jest.Mock;
    expect(spy).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(spy.mock.contexts.every((c: Element) => element.contains(c))).toBe(
      true,
    );
  });

  it('follows a changed list of views', async () => {
    views.set(DASHBOARDS.garage.views.slice(0, 3));
    const { element, harness } = await open('/app/garage');
    views.set(DASHBOARDS.garage.views.slice(0, 2));
    harness.detectChanges();
    expect(links(element)).toHaveLength(2);
  });

  it('follows a changed base address', async () => {
    views.set(DASHBOARDS.garage.views.slice(0, 2));
    const { element, harness } = await open('/app/driver');
    base.set('/app/driver');
    harness.detectChanges();
    expect(links(element).map((a) => a.getAttribute('href'))).toEqual([
      '/app/driver',
      '/app/driver/requests',
    ]);
  });

  it('does not interpret a label key containing markup as html', async () => {
    views.set([{ label: 'x', path: 'a', tab: '<img src=x onerror=alert(1)>' }]);
    const { element } = await open('/app/garage');
    expect(element.querySelector('mf-dashboard-tab-bar img')).toBeNull();
  });
});
