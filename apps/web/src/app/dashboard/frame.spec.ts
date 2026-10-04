import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';

import { Frame } from './frame';
import { Session } from './session';

function render(role: string, landing: string, capabilities: string[]) {
  const current = signal<MeDto | null>({
    capabilities,
    email: null,
    garageId: null,
    id: 'account-1',
    landing,
    language: 'ro',
    name: 'Ioana Pop',
    role,
    roles: [role],
  } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Session, useValue: { current } }],
  });
  const fixture = TestBed.createComponent(Frame);
  fixture.detectChanges();
  return { current, element: fixture.nativeElement as HTMLElement, fixture };
}

const menu = (element: HTMLElement) =>
  [...element.querySelectorAll('nav button')].map((b) => b.textContent?.trim());

describe('Frame', () => {
  it('shows the full garage menu to an owner', () => {
    const { element } = render('garage', '/app/garage', [
      'garage.requests',
      'garage.schedule',
      'garage.final_price',
      'garage.own_jobs',
      'garage.reviews',
      'garage.team',
      'garage.prices',
      'garage.profile',
      'garage.feature_switches',
    ]);

    expect(menu(element)).toEqual([
      'Panou',
      'Cereri de ofertă',
      'Programări',
      'Mecanici',
      'Prețuri',
      'Recenzii',
      'Profilul service-ului',
    ]);
  });

  it('hides team, prices and the garage profile from a receptionist', () => {
    const { element } = render('receptionist', '/app/garage', [
      'garage.requests',
      'garage.schedule',
      'garage.final_price',
      'garage.own_jobs',
    ]);

    expect(menu(element)).toEqual(['Panou', 'Cereri de ofertă', 'Programări']);
  });

  it('shows a mechanic only their own jobs', () => {
    const { element } = render('mechanic', '/app/garage', ['garage.own_jobs']);

    expect(menu(element)).toEqual(['Panou']);
  });

  it('shows the driver and admin menus', () => {
    expect(
      menu(
        render('driver', '/app/driver', [
          'driver.requests',
          'driver.cars',
          'driver.reviews',
          'driver.saved_garages',
          'driver.settings',
        ]).element,
      ),
    ).toEqual([
      'Panou',
      'Cererile mele',
      'Mașinile mele',
      'Recenziile mele',
      'Service-uri salvate',
      'Setări',
    ]);
    TestBed.resetTestingModule();
    expect(
      menu(
        render('admin', '/app/admin', [
          'admin.garages',
          'admin.users',
          'admin.reviews',
          'admin.catalogue',
          'admin.settings',
        ]).element,
      ),
    ).toEqual([
      'Panou',
      'Service-uri',
      'Utilizatori',
      'Recenzii raportate',
      'Mărci și lucrări',
      'Setări',
    ]);
  });

  it('puts the name and "Ieși din cont" after the menu, with no demo role buttons', () => {
    const { element } = render('driver', '/app/driver', []);
    const text = element.textContent ?? '';

    expect(text).toContain('Ioana Pop');
    expect(text).not.toMatch(/vezi ca/i);
    const nav = element.querySelector('nav');
    const signOut = [...element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Ieși din cont',
    );
    expect(signOut).toBeDefined();
    expect(nav?.compareDocumentPosition(signOut as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('shows the chosen entry as the title over a plain empty state', () => {
    const { element, fixture } = render('driver', '/app/driver', [
      'driver.cars',
    ]);

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Panou');
    expect(element.querySelector('main')?.textContent).toContain(
      'Nimic aici încă.',
    );
    (element.querySelectorAll('nav button')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(element.querySelector('h1')?.textContent?.trim()).toBe(
      'Mașinile mele',
    );
  });

  it('signs out to Home and forgets the account', async () => {
    const { current, element } = render('driver', '/app/driver', []);
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    [...element.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Ieși din cont')
      ?.click();

    expect(current()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
