import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { SignInDialog } from './sign-in-dialog';
import { Session } from '../dashboard/session';

const ME = { landing: '/app/driver' } as MeDto;
const INVITED = { email: 'elena@example.ro', name: 'Elena Stan' };

type Answer =
  | 'signed-in'
  | 'cancelled'
  | { switchTo: 'sign-in' | 'sign-up' | 'reset'; email: string };

function setup(sessionAfterSignIn: MeDto | null, ...answers: Answer[]) {
  const current = signal<MeDto | null>(null);
  const open = jest.fn(async (..._: unknown[]) => {
    const answer = answers.shift() ?? 'cancelled';
    if (answer === 'signed-in') current.set(sessionAfterSignIn);
    return answer;
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Session, useValue: { current, load: async () => current() } },
      { provide: Overlays, useValue: { open } },
    ],
  });
  jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { dialog: TestBed.inject(SignInDialog), open };
}

describe('SignInDialog.join under unusual paths', () => {
  it('says null when the dialog reports signed in but no session exists', async () => {
    const { dialog } = setup(null, 'signed-in');
    await expect(dialog.join(INVITED)).resolves.toBeNull();
  });

  it('says signed-in for an existing account reached through the password reset', async () => {
    const { dialog, open } = setup(
      ME,
      { email: 'a@b.ro', switchTo: 'sign-in' },
      { email: 'a@b.ro', switchTo: 'reset' },
      { email: 'a@b.ro', switchTo: 'sign-in' },
      'signed-in',
    );

    await expect(dialog.join(INVITED)).resolves.toBe('signed-in');
    expect(open).toHaveBeenCalledTimes(4);
  });

  it('says signed-up when the person wandered to sign-in and back to account creation', async () => {
    const { dialog } = setup(
      ME,
      { email: 'a@b.ro', switchTo: 'sign-in' },
      { email: 'a@b.ro', switchTo: 'sign-up' },
      'signed-in',
    );
    await expect(dialog.join(INVITED)).resolves.toBe('signed-up');
  });

  it('ends with null when the reset dialog is closed', async () => {
    const { dialog } = setup(
      ME,
      { email: 'a@b.ro', switchTo: 'reset' },
      'cancelled',
    );
    await expect(dialog.join(INVITED)).resolves.toBeNull();
  });

  it('can be asked again after a closed dialog', async () => {
    const { dialog, open } = setup(ME, 'cancelled', 'signed-in');

    await expect(dialog.join(INVITED)).resolves.toBeNull();
    await expect(dialog.join(INVITED)).resolves.toBe('signed-up');
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('passes a hostile invited name to account creation untouched', async () => {
    const { dialog, open } = setup(ME, 'cancelled');
    const invited = { email: 'x@y.ro', name: '<script>alert(1)</script>' };

    await dialog.join(invited);

    expect(open.mock.calls[0]?.[1]).toEqual({
      data: invited,
      shape: 'dialog',
      title: 'public.signUp.title',
    });
  });
});
