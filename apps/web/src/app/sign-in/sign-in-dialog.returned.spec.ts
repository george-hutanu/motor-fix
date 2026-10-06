import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { ProviderSignUp } from './provider-sign-up';
import { SignIn } from './sign-in';
import { SignInDialog } from './sign-in-dialog';
import { Session } from '../dashboard/session';

const DRIVER = { landing: '/app/driver' } as MeDto;

function setup(...answers: unknown[]) {
  const current = signal<MeDto | null>(null);
  const open = jest.fn(async (..._: unknown[]) => {
    const answer = answers.shift() ?? 'cancelled';
    if (answer === 'signed-in') current.set(DRIVER);
    return answer;
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Session,
        useValue: { current, load: jest.fn(async () => current()) },
      },
      { provide: Overlays, useValue: { open } },
    ],
  });
  jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { dialog: TestBed.inject(SignInDialog), open };
}

const loaded = (open: jest.Mock, call: number) =>
  (open.mock.calls[call][0] as () => Promise<unknown>)();

describe('the sign-in dialog after a provider', () => {
  it('opens the new-person step for a consent result, and answers signed in once the account exists', async () => {
    const { dialog, open } = setup('signed-in');

    await expect(dialog.returned('consent', 'google')).resolves.toBe(true);

    expect(open).toHaveBeenCalledWith(expect.any(Function), {
      shape: 'dialog',
      title: 'public.providerSignUp.title',
    });
    await expect(loaded(open, 0)).resolves.toBe(ProviderSignUp);
  });

  it('opens sign-in with no message after a cancel', async () => {
    const { dialog, open } = setup('cancelled');

    await expect(dialog.returned('cancelled', 'apple')).resolves.toBe(false);

    expect(open).toHaveBeenCalledWith(expect.any(Function), {
      shape: 'dialog',
      title: 'public.signIn.title',
    });
    await expect(loaded(open, 0)).resolves.toBe(SignIn);
  });

  it.each(['failed', 'maintenance', 'suspended', 'email_taken'] as const)(
    'opens sign-in with the "%s" message for the provider',
    async (result) => {
      const { dialog, open } = setup('cancelled');

      await dialog.returned(result, 'apple');

      expect(open).toHaveBeenCalledWith(expect.any(Function), {
        data: { problem: { code: result, provider: 'apple' } },
        shape: 'dialog',
        title: 'public.signIn.title',
      });
    },
  );

  it('goes on to sign-in from the expired new-person step', async () => {
    const { dialog, open } = setup(
      { email: '', switchTo: 'sign-in' },
      'signed-in',
    );

    await expect(dialog.returned('consent', 'google')).resolves.toBe(true);

    expect(open).toHaveBeenCalledTimes(2);
    await expect(loaded(open, 1)).resolves.toBe(SignIn);
  });
});
