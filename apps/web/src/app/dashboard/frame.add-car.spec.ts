import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import { type MeDto, NotificationsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { Subject } from 'rxjs';

import { AddCar } from './add-car/add-car';
import { Frame } from './frame';
import { Live } from './live';
import { Session } from './session';
import { dashboardRoutes } from './views';

const me = (role: string, roles: string[], capabilities: string[]) =>
  ({
    capabilities,
    email: null,
    garageId: 'garage-1',
    id: 'account-1',
    landing: '/app/garage',
    language: 'ro',
    name: 'Mihai Ionescu',
    role,
    roles,
  }) as unknown as MeDto;

const OWNER = ['garage.own_jobs', 'garage.team'];

async function render(
  roles: string[] = ['garage'],
  role = 'garage',
  capabilities = OWNER,
) {
  Element.prototype.scrollIntoView = jest.fn();
  const overlays = { open: jest.fn(async (): Promise<unknown> => 'cancelled') };
  const reload = jest.fn(async () => undefined);
  const account = signal<MeDto | null>(me(role, roles, capabilities));
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
          reload,
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
  return {
    element: harness.fixture.nativeElement as HTMLElement,
    overlays,
    reload,
  };
}

const named = (element: HTMLElement, name: string) =>
  [...element.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  );
const addCar = (element: HTMLElement) => named(element, 'Adaugă o mașină');

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('the frame\'s "Adaugă o mașină"', () => {
  it('is offered to a garage account that is not a driver, before the invite', async () => {
    const { element } = await render();

    const buttons = [...element.querySelectorAll('button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(buttons).toContain('Adaugă o mașină');
    expect(buttons.indexOf('Adaugă o mașină')).toBeLessThan(
      buttons.indexOf('Invită în echipă'),
    );
  });

  it('opens the add-a-car dialog with no plates held', async () => {
    const { element, overlays } = await render();

    addCar(element)?.click();

    expect(overlays.open).toHaveBeenCalledWith(AddCar, {
      data: { plates: [] },
      shape: 'dialog',
      title: 'driver.cars.add.title',
    });
  });

  it('reloads the session once a car is saved, so the driver role shows', async () => {
    const { element, overlays, reload } = await render();
    overlays.open.mockResolvedValueOnce({ id: 'car-1' });

    addCar(element)?.click();
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads nothing when the dialog is cancelled', async () => {
    const { element, reload } = await render();

    addCar(element)?.click();
    await settle();

    expect(reload).not.toHaveBeenCalled();
  });

  it('is not offered to an account that is already a driver', async () => {
    const { element } = await render(['driver', 'garage']);

    expect(addCar(element)).toBeUndefined();
  });

  it('is not offered to a receptionist or a mechanic', async () => {
    const receptionist = await render(['receptionist'], 'receptionist', [
      'garage.requests',
    ]);
    expect(addCar(receptionist.element)).toBeUndefined();
    TestBed.resetTestingModule();

    const mechanic = await render(['mechanic'], 'mechanic', [
      'garage.own_jobs',
    ]);
    expect(addCar(mechanic.element)).toBeUndefined();
  });

  it('reads English', async () => {
    const { element } = await render();
    await TestBed.inject(I18n).use('en');
    await settle();
    TestBed.tick();

    expect(named(element, 'Add a car')).toBeDefined();
  });
});
