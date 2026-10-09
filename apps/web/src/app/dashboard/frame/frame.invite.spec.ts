import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import { type MeDto, NotificationsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { Subject } from 'rxjs';

import { Frame } from './frame';
import { Live } from '../live';
import { Session } from '../session';
import { dashboardRoutes } from '../views';

const me = (role: string, capabilities: string[]) =>
  ({
    capabilities,
    email: null,
    garageAccess: [],
    garageId: 'garage-1',
    id: 'account-1',
    landing: '/app/garage',
    language: 'ro',
    name: 'Mihai Ionescu',
    role,
    roles: [role],
  }) as unknown as MeDto;

async function render(role: string, capabilities: string[]) {
  Element.prototype.scrollIntoView = jest.fn();
  const overlays = { open: jest.fn(async () => 'cancelled') };
  const account = signal<MeDto | null>(me(role, capabilities));
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
          open: jest.fn(),
          resync: new Subject<void>(),
        },
      },
      {
        provide: NotificationsService,
        useValue: { bellControllerUnreadCount: async () => ({ count: 0 }) },
      },
      { provide: Overlays, useValue: overlays },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/app/garage');
  harness.detectChanges();
  return { element: harness.fixture.nativeElement as HTMLElement, overlays };
}

const invite = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === 'Invită în echipă',
  );

describe('the frame\'s "Invită în echipă"', () => {
  it("opens the invite dialog for the owner's garage", async () => {
    const { element, overlays } = await render('garage', [
      'garage.own_jobs',
      'garage.team',
    ]);

    invite(element)?.click();

    expect(overlays.open).toHaveBeenCalledWith(expect.any(Function), {
      data: { garageId: 'garage-1' },
      shape: 'dialog',
      title: 'garage.invite.title',
    });
  });

  // @traces 131-FR-011
  it('is not offered to a receptionist or a mechanic', async () => {
    const receptionist = await render('receptionist', [
      'garage.requests',
      'garage.own_jobs',
    ]);
    expect(invite(receptionist.element)).toBeUndefined();
    TestBed.resetTestingModule();

    const mechanic = await render('mechanic', ['garage.own_jobs']);
    expect(invite(mechanic.element)).toBeUndefined();
  });

  it('reads English', async () => {
    const { element } = await render('garage', ['garage.team']);
    await TestBed.inject(I18n).use('en');
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();

    expect(
      [...element.querySelectorAll('button')].some(
        (b) => b.textContent?.trim() === 'Invite to the team',
      ),
    ).toBe(true);
  });
});
