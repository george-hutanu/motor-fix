import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MeDto } from '@motor-fix/data-access';
import { NEVER, Subject } from 'rxjs';

import { Frame } from './frame/frame';
import { Live } from './live';
import { Session } from './session';
import { allowedViews, DASHBOARDS, dashboardRoutes } from './views';

const ALL = [
  'driver.requests',
  'driver.cars',
  'driver.reviews',
  'driver.saved_garages',
  'driver.settings',
];

const paths = (views: readonly { path: string }[]) => views.map((v) => v.path);

describe('the driver dashboard views', () => {
  it('lists seven views in order', () => {
    expect(paths(DASHBOARDS.driver.views)).toEqual([
      '',
      'requests',
      'cars',
      'reviews',
      'saved',
      'assistant',
      'settings',
    ]);
  });

  it('marks only the assistant as unreleased', () => {
    expect(
      DASHBOARDS.driver.views.filter((v) => v.unreleased).map((v) => v.path),
    ).toEqual(['assistant']);
  });

  it('gives every view a title of its own', () => {
    const titles = DASHBOARDS.driver.views.map((v) => v.title);
    expect(titles.every((t) => typeof t === 'string' && t.length > 0)).toBe(
      true,
    );
    expect(new Set(titles).size).toBe(7);
  });

  it('hides the assistant even with every capability', () => {
    expect(paths(allowedViews('driver', ALL))).toEqual([
      '',
      'requests',
      'cars',
      'reviews',
      'saved',
      'settings',
    ]);
  });

  it('hides the assistant even with a capability made up for it', () => {
    expect(
      paths(allowedViews('driver', [...ALL, 'driver.assistant'])),
    ).not.toContain('assistant');
  });

  it('shows only the home view with no capability', () => {
    expect(paths(allowedViews('driver', []))).toEqual(['']);
  });

  it('keeps the order of the list whatever the order of the capabilities', () => {
    expect(paths(allowedViews('driver', [...ALL].reverse()))).toEqual([
      '',
      'requests',
      'cars',
      'reviews',
      'saved',
      'settings',
    ]);
  });

  it('has no route for the assistant and a fall-through to the dashboard', () => {
    const routes = dashboardRoutes('driver');
    expect(routes.map((r) => r.path)).toEqual([
      '',
      'requests',
      'cars',
      'reviews',
      'saved',
      'settings',
      '**',
    ]);
    expect(routes.at(-1)?.redirectTo).toBe('');
  });
});

const me = {
  capabilities: ALL,
  email: null,
  garageAccess: [],
  garageId: null,
  id: 'a',
  landing: '/app/driver',
  language: 'ro',
  name: 'Andrei M.',
  role: 'driver',
  roles: ['driver'],
} as unknown as MeDto;

async function open(url: string) {
  Element.prototype.scrollIntoView = jest.fn();
  const current = signal<MeDto | null>(me);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: dashboardRoutes('driver'),
          component: Frame,
          path: 'app/driver',
        },
      ]),
      {
        provide: Session,
        useValue: {
          current,
          ended: new Subject<void>(),
          shown: current,
          signOut: jest.fn(),
        },
      },
      {
        provide: Live,
        useValue: {
          close: jest.fn(),
          events: new Subject(),
          offline: signal(false),
          on: () => NEVER,
          open: jest.fn(),
          resync: new Subject(),
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  await harness.fixture.whenStable();
  harness.detectChanges();
  return {
    element: harness.fixture.nativeElement as HTMLElement,
    url: () => TestBed.inject(Router).url,
  };
}

describe('the driver dashboard at the assistant address', () => {
  it.each([
    '/app/driver/assistant',
    '/app/driver/assistant/deep/er',
    '/app/driver/assistant?x=1',
  ])('opens the dashboard for %s', async (url) => {
    const { element, url: now } = await open(url);

    expect(now().startsWith('/app/driver/assistant')).toBe(false);
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Panoul tău');
  });

  it('offers no assistant entry in the menu or the bar', async () => {
    const { element } = await open('/app/driver');

    const hrefs = [...element.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs.some((h) => h?.includes('assistant'))).toBe(false);
  });
});
