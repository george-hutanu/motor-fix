import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { DashboardTabBar } from './tab-bar';
import { type Counts, DASHBOARDS } from '../views';

@Component({ template: '' })
class Blank {}

const counts = signal<Counts>({});
const loading = signal(false);
const views = DASHBOARDS.admin.views.filter((v) => !v.unreleased);

@Component({
  imports: [DashboardTabBar],
  template: `<mf-dashboard-tab-bar base="/app/admin" [views]="views" name="shell.frame.bar.admin" [counts]="counts()" [countsLoading]="loading()" />`,
})
class Host {
  readonly counts = counts;
  readonly loading = loading;
  readonly views = views;
}

async function open() {
  Element.prototype.scrollIntoView = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: [{ component: Blank, path: '**' }],
          component: Host,
          path: 'app/admin',
        },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/app/admin');
  harness.detectChanges();
  return harness;
}
const tab = (e: HTMLElement, path: string) =>
  e.querySelector<HTMLAnchorElement>(
    `nav a[href="/app/admin${path ? `/${path}` : ''}"]`,
  ) as HTMLAnchorElement;

afterEach(() => {
  counts.set({});
  loading.set(false);
});

describe('the admin tab bar counters', () => {
  it('shows no chip and no accessible count for zero', async () => {
    counts.set({ garagesWaiting: 0 });
    const harness = await open();
    const garages = tab(harness.routeNativeElement as HTMLElement, 'garages');

    expect(garages.querySelector('.chip')).toBeNull();
    expect(garages.getAttribute('aria-label')).toBeNull();
  });

  it.each([
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [12345, '99+'],
  ])('writes %i as %s in the chip', async (n, text) => {
    counts.set({ garagesWaiting: n });
    const harness = await open();
    const garages = tab(harness.routeNativeElement as HTMLElement, 'garages');

    expect(garages.querySelector('.chip')?.textContent).toBe(text);
  });

  it('keeps the full number in the accessible name above 99', async () => {
    counts.set({ garagesWaiting: 1234 });
    const harness = await open();
    const garages = tab(harness.routeNativeElement as HTMLElement, 'garages');

    expect(garages.getAttribute('aria-label')).toBe(
      'Service‑uri, 1234 în așteptare',
    );
  });

  it('puts the chip on the Service‑uri tab only', async () => {
    counts.set({ garagesWaiting: 4 });
    const harness = await open();
    const e = harness.routeNativeElement as HTMLElement;

    expect(e.querySelectorAll('.chip')).toHaveLength(1);
    expect(tab(e, '').querySelector('.chip')).toBeNull();
    expect(tab(e, 'settings').querySelector('.chip')).toBeNull();
  });

  it('shows a skeleton on the counter tab while loading, and no number', async () => {
    loading.set(true);
    const harness = await open();
    const e = harness.routeNativeElement as HTMLElement;

    expect(tab(e, 'garages').querySelector('.chip-skeleton')).not.toBeNull();
    expect(tab(e, 'garages').querySelector('.chip')).toBeNull();
    expect(e.querySelectorAll('.chip-skeleton')).toHaveLength(1);
  });

  it('shows the number, not a skeleton, when a count is known during a read', async () => {
    counts.set({ garagesWaiting: 3 });
    loading.set(true);
    const harness = await open();
    const garages = tab(harness.routeNativeElement as HTMLElement, 'garages');

    expect(garages.querySelector('.chip')?.textContent).toBe('3');
    expect(garages.querySelector('.chip-skeleton')).toBeNull();
  });

  it('drops the chip when the count goes away', async () => {
    counts.set({ garagesWaiting: 3 });
    const harness = await open();
    counts.set({});
    harness.detectChanges();
    const garages = tab(harness.routeNativeElement as HTMLElement, 'garages');

    expect(garages.querySelector('.chip')).toBeNull();
    expect(garages.getAttribute('aria-label')).toBeNull();
  });

  it('shows no chip for a negative or non-numeric count', async () => {
    counts.set({ garagesWaiting: Number.NaN });
    const harness = await open();
    const garages = tab(harness.routeNativeElement as HTMLElement, 'garages');

    expect(garages.querySelector('.chip')).toBeNull();
  });
});
