import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  GarageRequestsService,
  type MeDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { NEVER, Subject } from 'rxjs';

import { Frame } from './frame';
import { Live } from '../live';
import { Session } from '../session';
import { DASHBOARDS, dashboardRoutes } from '../views';

// @traces 280-FR-003

const me = (role: string, landing: string, capabilities: string[]) =>
  ({
    capabilities,
    email: 'mihai@example.test',
    garageAccess: [],
    garageId: 'garage-1',
    id: 'account-1',
    landing,
    language: 'ro',
    name: 'Mihai Ionescu',
    role,
    roles: [role],
  }) as unknown as MeDto;

async function render(
  role: string,
  url: string,
  capabilities: string[] = [],
  language: 'ro' | 'en' = 'ro',
) {
  Element.prototype.scrollIntoView = jest.fn();
  const overlays = { open: jest.fn(async () => 'cancelled') };
  const landing = url.split('/').slice(0, 3).join('/');
  const account = signal<MeDto | null>(me(role, landing, capabilities));
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        (['driver', 'garage', 'admin'] as const).map((area) => ({
          children: dashboardRoutes(area),
          component: Frame,
          path: `app/${area}`,
        })),
      ),
      {
        provide: Session,
        useValue: {
          current: account,
          ended: new Subject<void>(),
          shown: account,
        },
      },
      {
        provide: Live,
        useValue: {
          close: jest.fn(),
          events: new Subject<LiveMessage>(),
          offline: signal(false),
          on: () => NEVER,
          open: jest.fn(),
          resync: new Subject<void>(),
          state: signal('open'),
        },
      },
      {
        provide: GarageRequestsService,
        useValue: {
          garageRequestsControllerList: async () => ({
            items: [],
            nextCursor: null,
            total: 0,
          }),
        },
      },
      {
        provide: NotificationsService,
        useValue: { bellControllerUnreadCount: async () => ({ count: 0 }) },
      },
      { provide: Overlays, useValue: overlays },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  return { element: harness.fixture.nativeElement as HTMLElement, overlays };
}

const entries = (nav: Element | null) =>
  [...(nav?.children ?? [])].map((e) => [e.tagName, e.textContent?.trim()]);
const menu = (element: HTMLElement) => element.querySelector('aside nav');
const bar = (element: HTMLElement) =>
  element.querySelector('mf-dashboard-tab-bar nav');

describe('"Ajutor și contact" in the dashboards\' menus', () => {
  it('ends the garage menu and tab bar, after Setări, as a button for every garage role', async () => {
    const { element } = await render('mechanic', '/app/garage/settings', [
      'garage.own_jobs',
    ]);

    const side = entries(menu(element));
    expect(side.at(-1)).toEqual(['BUTTON', 'Ajutor și contact']);
    expect(side.findIndex(([, name]) => name === 'Setări')).toBeLessThan(
      side.length - 1,
    );
    const tabs = entries(bar(element));
    expect(tabs.at(-1)).toEqual(['BUTTON', 'Ajutor și contact']);
  });

  it('ends the driver menu and tab bar, in English too', async () => {
    const { element } = await render(
      'driver',
      '/app/driver/reviews',
      ['driver.reviews', 'driver.settings'],
      'en',
    );

    expect(entries(menu(element)).at(-1)).toEqual([
      'BUTTON',
      'Help and contact',
    ]);
    expect(entries(bar(element)).at(-1)).toEqual([
      'BUTTON',
      'Help and contact',
    ]);
  });

  it('opens the contact drawer over the view on screen, without leaving it', async () => {
    const { element, overlays } = await render(
      'driver',
      '/app/driver/reviews',
      ['driver.reviews'],
    );

    ((menu(element) as Element).lastElementChild as HTMLButtonElement).click();
    ((bar(element) as Element).lastElementChild as HTMLButtonElement).click();

    expect(overlays.open).toHaveBeenCalledTimes(2);
    expect(overlays.open).toHaveBeenCalledWith(expect.any(Function), {
      shape: 'drawer',
      title: 'shell.contact.title',
    });
    expect(TestBed.inject(Router).url).toBe('/app/driver/reviews');
  });

  it('has no route of its own and is not in the admin menu', () => {
    expect(DASHBOARDS.admin.actions).toBeUndefined();
    for (const area of ['driver', 'garage'] as const) {
      expect(
        dashboardRoutes(area).some((route) => route.path === 'contact'),
      ).toBe(false);
    }
  });
});
