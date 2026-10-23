import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { type MeDto, SupportService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { DeleteAccount } from './delete-account';
import { DeleteAccountDialog } from '../delete-account-dialog/delete-account-dialog';
import { Session } from '../session';

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
) {
  open = jest.fn(async () => 'cancelled');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Session, useValue: { current: signal(me) } },
      { provide: Overlays, useValue: { open } },
      {
        provide: SupportService,
        useValue: { supportContactControllerContact: async () => ({ email }) },
      },
    ],
  });
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
