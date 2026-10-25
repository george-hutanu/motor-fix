import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { type MeDto, SupportService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { DeleteAccount } from './delete-account';
import { DeleteAccountDialog } from '../delete-account-dialog/delete-account-dialog';
import { Live } from '../live';
import { PushDevice } from '../push-device';
import { Session } from '../session';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const DRIVER = {
  email: 'andrei@example.ro',
  garageAccess: [],
  phone: null,
  role: 'driver',
} as unknown as MeDto;

const OWNER = {
  ...DRIVER,
  garageAccess: [{ garageId: 'g1', role: 'owner' }],
  role: 'garage',
} as unknown as MeDto;

let open: jest.Mock;
let close: jest.Mock;
let dropped: jest.Mock;
let revoked: jest.Mock;
let navigate: jest.SpyInstance;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function render(
  me: MeDto,
  language: 'ro' | 'en' = 'ro',
  email: string | null = 'ajutor@example.ro',
  answer: true | 'cancelled' = 'cancelled',
) {
  open = jest.fn(async () => answer);
  close = jest.fn();
  dropped = jest.fn(async () => undefined);
  revoked = jest.fn();
  jest.mocked(toast).mockClear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Session, useValue: { current: signal(me), revoked } },
      { provide: Live, useValue: { close } },
      { provide: PushDevice, useValue: { dropped } },
      { provide: Overlays, useValue: { open } },
      {
        provide: SupportService,
        useValue: { supportContactControllerContact: async () => ({ email }) },
      },
    ],
  });
  navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(DeleteAccount);
  fixture.autoDetectChanges();
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const button = (element: HTMLElement) =>
  element.querySelector('button') as HTMLButtonElement;

// @traces 129-FR-014
describe('the delete-account row in Setări', () => {
  it('offers a driver the button, which opens the confirmation dialog', async () => {
    const element = await render(DRIVER);

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Ștergerea contului',
    );
    expect(button(element).textContent?.trim()).toBe('Șterge contul');
    expect(button(element).disabled).toBe(false);
    expect(element.querySelector('a')).toBeNull();

    button(element).click();
    await settle();

    expect(open).toHaveBeenCalledWith(DeleteAccountDialog, {
      confirmDiscard: false,
      shape: 'dialog',
      title: 'shell.deleteAccount.dialogTitle',
    });
  });

  // @traces 129-FR-008
  it('signs the tab out to Home with a toast once the dialog is gone, the account deleted', async () => {
    const element = await render(DRIVER, 'ro', 'ajutor@example.ro', true);

    button(element).click();
    await settle();

    expect(close).toHaveBeenCalledTimes(1);
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(revoked).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(toast).toHaveBeenCalledWith('Contul tău a fost șters');
    // Nothing is asked of the server any more, and the way Home starts only
    // after the dialog has stepped back, so its step back cannot undo it.
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0],
    );
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0],
    );
    expect(dropped.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0],
    );
  });

  // @traces 129-FR-008
  it('forgets the session only once Home has opened, so the dashboard sends no second way Home that would drop the toast', async () => {
    const element = await render(DRIVER, 'ro', 'ajutor@example.ro', true);
    let arrive: (arrived: boolean) => void = () => undefined;
    navigate.mockReturnValue(
      new Promise<boolean>((resolve) => {
        arrive = resolve;
      }),
    );

    button(element).click();
    await settle();

    expect(navigate).toHaveBeenCalledWith('/');
    expect(revoked).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();

    arrive(true);
    await settle();

    expect(revoked).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Contul tău a fost șters');
    expect(revoked.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(toast).mock.invocationCallOrder[0],
    );
  });

  it('keeps the tab signed in when the dialog is closed without deleting', async () => {
    const element = await render(DRIVER);

    button(element).click();
    await settle();

    expect(revoked).not.toHaveBeenCalled();
    expect(dropped).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('disables the button for a garage owner and shows the way to close the garage', async () => {
    const element = await render(OWNER);

    expect(button(element).disabled).toBe(true);
    expect(element.textContent).toContain('Contul tău deține un service.');
    const links = [...element.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/ro/contact',
      'mailto:ajutor@example.ro',
    ]);
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Formularul de contact',
      'ajutor@example.ro',
    ]);

    button(element).click();
    await settle();
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps the contact form when no support address is set', async () => {
    const element = await render(OWNER, 'ro', null);

    expect(
      [...element.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    ).toEqual(['/ro/contact']);
  });

  it('lets a mechanic or receptionist delete the account', async () => {
    const element = await render({
      ...DRIVER,
      garageAccess: [{ garageId: 'g1', role: 'mechanic' }],
    } as unknown as MeDto);

    expect(button(element).disabled).toBe(false);
  });

  it('reads English', async () => {
    const element = await render(OWNER, 'en');

    expect(button(element).textContent?.trim()).toBe('Delete account');
    expect(element.textContent).toContain('Your account owns a garage.');
    expect(element.querySelector('a')?.getAttribute('href')).toBe(
      '/en/contact',
    );
  });
});

// @traces 140-FR-015
describe('the delete-account row inside the account panel', () => {
  it('heads the row one level down and drops its own card', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Session, useValue: { current: signal(DRIVER) } },
        { provide: Overlays, useValue: { open: jest.fn() } },
        {
          provide: SupportService,
          useValue: { supportContactControllerContact: async () => ({}) },
        },
      ],
    });
    const fixture = TestBed.createComponent(DeleteAccount);
    fixture.componentRef.setInput('inPanel', true);
    fixture.autoDetectChanges();
    await settle();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.classList).toContain('in-panel');
    expect(element.querySelector('h2')).toBeNull();
    expect(element.querySelector('h3')?.textContent?.trim()).toBe(
      'Ștergerea contului',
    );
    expect(button(element).textContent?.trim()).toBe('Șterge contul');
  });
});
