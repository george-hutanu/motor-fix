import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import type { MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';
import { Subject } from 'rxjs';

import { Frame } from './frame';
import { Live } from './live';
import { Session } from './session';
import { dashboardRoutes } from './views';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

type Role = 'driver' | 'garage' | 'receptionist' | 'mechanic' | 'admin';

const LANDING: Record<Role, string> = {
  admin: '/app/admin',
  driver: '/app/driver',
  garage: '/app/garage',
  mechanic: '/app/garage',
  receptionist: '/app/garage',
};

const me = (role: Role, roles: Role[]) =>
  ({
    capabilities: [],
    email: null,
    garageId: null,
    id: 'account-1',
    landing: LANDING[role],
    language: 'ro',
    name: 'Mihai Ionescu',
    role,
    roles,
  }) as unknown as MeDto;

async function render(
  role: Role,
  roles: Role[],
  switchRole: (to: Role) => Promise<unknown> = async () => undefined,
) {
  Element.prototype.scrollIntoView = jest.fn();
  const current = signal<MeDto | null>(me(role, roles));
  const live = {
    close: jest.fn(),
    events: new Subject<LiveMessage>(),
    open: jest.fn(),
  };
  const session = {
    current,
    ended: new Subject<void>(),
    signOut: jest.fn(async () => current.set(null)),
    switchRole: jest.fn(async (to: Role) => {
      await switchRole(to);
      current.set(me(to, roles));
      return current();
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        (['driver', 'garage', 'admin'] as const).map((area) => ({
          children: dashboardRoutes(area),
          component: Frame,
          path: `app/${area}`,
        })),
      ),
      { provide: Session, useValue: session },
      { provide: Live, useValue: live },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(LANDING[role]);
  harness.detectChanges();
  const element = harness.fixture.nativeElement as HTMLElement;
  return { current, element, harness, live, session };
}

const group = (element: HTMLElement) =>
  element.querySelector<HTMLElement>('.account [role="group"]');
const chips = (element: HTMLElement) => [
  ...(group(element)?.querySelectorAll<HTMLButtonElement>('button') ?? []),
];
const chip = (element: HTMLElement, name: string) =>
  chips(element).find((b) => b.textContent?.trim() === name);
const settle = async (harness: RouterTestingHarness) => {
  // The tap's switch answers on a later task than the click.
  await new Promise((resolve) => setTimeout(resolve));
  harness.detectChanges();
  await harness.fixture.whenStable();
  harness.detectChanges();
};
const url = () => TestBed.inject(Router).url;

beforeEach(() => (toast as unknown as jest.Mock).mockClear());

describe('Frame, the role chips', () => {
  it('shows a chip per role of a driver and garage, the one in use pressed', async () => {
    const { element } = await render('garage', ['driver', 'garage']);

    expect(group(element)?.getAttribute('aria-label')).toBe('Rolul tău');
    expect(chips(element).map((b) => b.textContent?.trim())).toEqual([
      'Șofer',
      'Service',
    ]);
    expect(chip(element, 'Service')?.getAttribute('aria-pressed')).toBe('true');
    expect(chip(element, 'Șofer')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('names a mechanic who also drives "Mecanic" and "Șofer"', async () => {
    const { element } = await render('mechanic', ['mechanic', 'driver']);

    expect(chips(element).map((b) => b.textContent?.trim())).toEqual([
      'Șofer',
      'Mecanic',
    ]);
  });

  it('labels every role in the fixed order', async () => {
    const { element } = await render('admin', [
      'admin',
      'mechanic',
      'receptionist',
      'garage',
      'driver',
    ]);

    expect(chips(element).map((b) => b.textContent?.trim())).toEqual([
      'Șofer',
      'Service',
      'Recepție',
      'Mecanic',
      'Admin',
    ]);
  });

  it.each(['driver', 'garage', 'admin'] as const)(
    'shows no chips to an account that is only a %s',
    async (role) => {
      const { element } = await render(role, [role]);

      expect(group(element)).toBeNull();
    },
  );

  it('names them in English', async () => {
    const { element, harness } = await render('garage', [
      'driver',
      'garage',
      'receptionist',
    ]);

    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(group(element)?.getAttribute('aria-label')).toBe('Your role');
    expect(chips(element).map((b) => b.textContent?.trim())).toEqual([
      'Driver',
      'Garage',
      'Front desk',
    ]);
  });

  it('switches to the role tapped, reopens the live connection and opens its dashboard', async () => {
    const { element, harness, live, session } = await render('garage', [
      'driver',
      'garage',
    ]);
    live.open.mockClear();

    chip(element, 'Șofer')?.click();
    await settle(harness);
    // The new area's frame replaces this one.
    await settle(harness);

    expect(session.switchRole).toHaveBeenCalledWith('driver');
    // Left open: the last call reopens it after the last close.
    const last = (mock: jest.Mock) =>
      Math.max(...mock.mock.invocationCallOrder);
    expect(live.close).toHaveBeenCalled();
    expect(last(live.open)).toBeGreaterThan(last(live.close));
    expect(url()).toBe('/app/driver');
    expect(chip(element, 'Șofer')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('reopens the live connection when the new role keeps the same dashboard', async () => {
    const { element, harness, live } = await render('garage', [
      'garage',
      'mechanic',
    ]);
    live.open.mockClear();

    chip(element, 'Mecanic')?.click();
    await settle(harness);

    expect(url()).toBe('/app/garage');
    expect(live.close).toHaveBeenCalledTimes(1);
    expect(live.open).toHaveBeenCalledTimes(1);
    expect(chip(element, 'Mecanic')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('does nothing when the role in use is tapped', async () => {
    const { element, harness, live, session } = await render('garage', [
      'driver',
      'garage',
    ]);

    chip(element, 'Service')?.click();
    await settle(harness);

    expect(session.switchRole).not.toHaveBeenCalled();
    expect(live.close).not.toHaveBeenCalled();
    expect(url()).toBe('/app/garage');
  });

  it('says so and keeps the role and the dashboard when the switch fails', async () => {
    const { element, harness, live, session } = await render(
      'garage',
      ['driver', 'garage'],
      () => Promise.reject(new Error('offline')),
    );
    live.open.mockClear();

    chip(element, 'Șofer')?.click();
    await settle(harness);

    expect(session.switchRole).toHaveBeenCalledWith('driver');
    expect(toast).toHaveBeenCalledWith(
      'Nu am putut schimba rolul. Încearcă din nou.',
    );
    expect(url()).toBe('/app/garage');
    expect(live.close).not.toHaveBeenCalled();
    expect(live.open).not.toHaveBeenCalled();
    expect(chip(element, 'Service')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('says it in English', async () => {
    const { element, harness } = await render(
      'garage',
      ['driver', 'garage'],
      () => Promise.reject(new Error('offline')),
    );
    await TestBed.inject(I18n).use('en');
    await settle(harness);

    chip(element, 'Driver')?.click();
    await settle(harness);

    expect(toast).toHaveBeenCalledWith('Could not switch the role. Try again.');
  });

  it('ignores a second tap while a switch is on its way', async () => {
    let answer: () => void = () => undefined;
    const { element, harness, session } = await render(
      'garage',
      ['driver', 'garage'],
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );

    chip(element, 'Șofer')?.click();
    harness.detectChanges();
    expect(chip(element, 'Șofer')?.disabled).toBe(true);
    chip(element, 'Șofer')?.click();
    answer();
    await settle(harness);

    expect(session.switchRole).toHaveBeenCalledTimes(1);
  });
});
