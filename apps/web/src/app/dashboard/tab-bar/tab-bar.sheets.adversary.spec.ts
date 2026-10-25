import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { OpenSheets } from '@motor-fix/overlays';

import { DashboardTabBar } from './tab-bar';
import { DASHBOARDS } from '../views';

@Component({ template: '' })
class Blank {}

@Component({
  imports: [DashboardTabBar],
  template: `<mf-dashboard-tab-bar base="/app/garage" [views]="views()" name="shell.frame.bar.garage" />`,
})
class Host {
  readonly views = signal(DASHBOARDS.garage.views.slice(0, 5));
}

async function open() {
  Element.prototype.scrollIntoView = jest.fn();
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
  await harness.navigateByUrl('/app/garage');
  harness.detectChanges();
  const bar = (
    harness.routeNativeElement as HTMLElement
  ).querySelector<HTMLElement>('mf-dashboard-tab-bar');
  return { bar, harness };
}

describe('the dashboard tab bar under sheets', () => {
  // @traces 1127-FR-004
  it('is not left hidden by stray closes that came before the first sheet', async () => {
    const { bar, harness } = await open();
    const sheets = TestBed.inject(OpenSheets);
    sheets.closed();
    sheets.closed();
    sheets.opened();
    harness.detectChanges();
    expect(bar?.style.visibility).toBe('hidden');

    sheets.closed();
    harness.detectChanges();
    expect(bar?.style.visibility).toBe('');
  });

  // @traces 1127-FR-004
  it('hides with visibility only, never with the hidden attribute or display', async () => {
    const { bar, harness } = await open();
    TestBed.inject(OpenSheets).opened();
    harness.detectChanges();

    expect(bar?.hidden).toBe(false);
    expect(bar?.style.display).toBe('');
    expect(bar?.style.visibility).toBe('hidden');
    expect(bar?.querySelectorAll('nav a')).toHaveLength(5);
  });

  // @traces 1127-FR-004
  it('shows again after a hundred stacked sheets all close', async () => {
    const { bar, harness } = await open();
    const sheets = TestBed.inject(OpenSheets);
    for (let i = 0; i < 100; i++) sheets.opened();
    for (let i = 0; i < 100; i++) sheets.closed();
    harness.detectChanges();

    expect(bar?.style.visibility).toBe('');
  });
});
