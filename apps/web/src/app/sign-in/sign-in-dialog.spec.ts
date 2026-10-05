import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { SignInDialog } from './sign-in-dialog';
import { Session } from '../dashboard/session';

const GARAGE = { landing: '/app/garage' } as MeDto;

type Answer =
  | 'signed-in'
  | 'cancelled'
  | { switchTo: 'sign-in' | 'sign-up' | 'reset'; email: string };

function setup(signedIn: MeDto | null, ...answers: Answer[]) {
  const current = signal<MeDto | null>(signedIn);
  const session = {
    current,
    load: jest.fn(async () => current()),
  };
  const open = jest.fn(async (..._: unknown[]) => {
    const answer = answers.shift() ?? 'cancelled';
    if (answer === 'signed-in') current.set(GARAGE);
    return answer;
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Session, useValue: session },
      { provide: Overlays, useValue: { open } },
    ],
  });
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  return { dialog: TestBed.inject(SignInDialog), navigate, open, session };
}

describe('SignInDialog', () => {
  it('takes a signed-in person straight to their dashboard', async () => {
    const { dialog, navigate, open } = setup(GARAGE, 'cancelled');

    await dialog.start();

    expect(open).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/app/garage');
  });

  it('opens the dialog over the current screen for a visitor', async () => {
    const { dialog, open } = setup(null, 'cancelled');

    await dialog.start();

    expect(open).toHaveBeenCalledWith(expect.any(Function), {
      shape: 'dialog',
      title: 'public.signIn.title',
    });
  });

  it("opens the person's dashboard after they sign in", async () => {
    const { dialog, navigate } = setup(null, 'signed-in');

    await dialog.start();

    expect(navigate).toHaveBeenCalledWith('/app/garage');
  });

  it('stays on the screen when the dialog is closed', async () => {
    const { dialog, navigate } = setup(null, 'cancelled');

    await dialog.start();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('switches to the sign-up dialog and back, carrying the e-mail', async () => {
    const { dialog, open } = setup(
      null,
      { email: 'andrei@example.ro', switchTo: 'sign-up' },
      { email: 'andrei@example.com', switchTo: 'sign-in' },
      'cancelled',
    );

    await dialog.start();

    expect(open.mock.calls.map((call) => call[1])).toEqual([
      { shape: 'dialog', title: 'public.signIn.title' },
      {
        data: { email: 'andrei@example.ro' },
        shape: 'dialog',
        title: 'public.signUp.title',
      },
      {
        data: { email: 'andrei@example.com' },
        shape: 'dialog',
        title: 'public.signIn.title',
      },
    ]);
  });

  it('opens the dashboard after an account is created in the sign-up dialog', async () => {
    const { dialog, navigate, open } = setup(
      null,
      { email: '', switchTo: 'sign-up' },
      'signed-in',
    );

    await dialog.start();

    expect(open).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('/app/garage');
  });

  it('stays on the screen when the sign-up dialog is closed', async () => {
    const { dialog, navigate, open } = setup(
      null,
      { email: '', switchTo: 'sign-up' },
      'cancelled',
    );

    await dialog.start();

    expect(open).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('loads the sign-up task only when it is opened', async () => {
    const { dialog, open } = setup(null, { email: '', switchTo: 'sign-up' });

    await dialog.start();
    const loader = (
      open.mock.calls[1] as unknown[]
    )[0] as () => Promise<unknown>;

    expect((await loader()) as { name: string }).toHaveProperty(
      'name',
      'SignUp',
    );
  });

  it('loads the sign-in task only when it is opened', async () => {
    const { dialog, open } = setup(null, 'cancelled');

    await dialog.start();
    const loader = (
      open.mock.calls[0] as unknown[]
    )[0] as () => Promise<unknown>;

    expect((await loader()) as { name: string }).toHaveProperty(
      'name',
      'SignIn',
    );
  });

  describe('a forgotten password', () => {
    it('opens the reset task with the e-mail, and sign-in again from it', async () => {
      const { dialog, open } = setup(
        null,
        { email: 'andrei@example.ro', switchTo: 'reset' },
        { email: 'andrei@example.com', switchTo: 'sign-in' },
        'cancelled',
      );

      await dialog.start();

      expect(open.mock.calls.map((call) => call[1])).toEqual([
        { shape: 'dialog', title: 'public.signIn.title' },
        {
          data: { email: 'andrei@example.ro' },
          shape: 'dialog',
          title: 'public.passwordReset.title',
        },
        {
          data: { email: 'andrei@example.com' },
          shape: 'dialog',
          title: 'public.signIn.title',
        },
      ]);
    });

    it('loads the reset task only when it is opened', async () => {
      const { dialog, open } = setup(null, { email: '', switchTo: 'reset' });

      await dialog.start();
      const loader = (
        open.mock.calls[1] as unknown[]
      )[0] as () => Promise<unknown>;

      expect((await loader()) as { name: string }).toHaveProperty(
        'name',
        'PasswordReset',
      );
    });

    it('opens the new-password task for a link and the dashboard once it is saved', async () => {
      const { dialog, navigate, open } = setup(null, 'signed-in');

      await expect(dialog.newPassword('the-token')).resolves.toBe(true);

      expect(open).toHaveBeenCalledWith(expect.any(Function), {
        data: { token: 'the-token' },
        shape: 'dialog',
        title: 'public.newPassword.title',
      });
      const loader = (
        open.mock.calls[0] as unknown[]
      )[0] as () => Promise<unknown>;
      expect((await loader()) as { name: string }).toHaveProperty(
        'name',
        'NewPassword',
      );
      expect(navigate).toHaveBeenCalledWith('/app/garage');
    });

    it('goes on to the reset task when a new link is asked for', async () => {
      const { dialog, open } = setup(
        null,
        { email: '', switchTo: 'reset' },
        'cancelled',
      );

      await expect(dialog.newPassword('the-token')).resolves.toBe(false);

      expect(open.mock.calls[1]?.[1]).toEqual({
        data: { email: '' },
        shape: 'dialog',
        title: 'public.passwordReset.title',
      });
    });

    it('resolves false and stays when the new-password task is closed', async () => {
      const { dialog, navigate } = setup(null, 'cancelled');

      await expect(dialog.newPassword('the-token')).resolves.toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('as the gate of an account action', () => {
    const reason = {
      data: { reason: true },
      shape: 'dialog',
      title: 'public.signIn.title',
    };

    it('opens the sign-in dialog with the reason and stays on the screen after sign-in', async () => {
      const { dialog, navigate, open } = setup(null, 'signed-in');

      await expect(dialog.gate()).resolves.toBe(true);

      expect(open).toHaveBeenCalledWith(expect.any(Function), reason);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('resolves signed in after an account is created in the sign-up dialog', async () => {
      const { dialog, navigate } = setup(
        null,
        { email: 'andrei@example.ro', switchTo: 'sign-up' },
        'signed-in',
      );

      await expect(dialog.gate()).resolves.toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('keeps the reason when the person switches to sign-up and back', async () => {
      const { dialog, open } = setup(
        null,
        { email: 'andrei@example.ro', switchTo: 'sign-up' },
        { email: 'andrei@example.ro', switchTo: 'sign-in' },
        'cancelled',
      );

      await dialog.gate();

      expect(open.mock.calls[2]?.[1]).toEqual({
        data: { email: 'andrei@example.ro', reason: true },
        shape: 'dialog',
        title: 'public.signIn.title',
      });
    });

    it('resolves not signed in when the dialog is closed', async () => {
      const { dialog } = setup(null, 'cancelled');

      await expect(dialog.gate()).resolves.toBe(false);
    });

    it('opens one dialog for calls that ask at the same time', async () => {
      const { dialog, open } = setup(null, 'signed-in');

      const answers = await Promise.all([dialog.gate(), dialog.gate()]);

      expect(answers).toEqual([true, true]);
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('waits on a sign-in dialog already open from "Autentificare", which still opens the dashboard', async () => {
      const { dialog, navigate, open, session } = setup(null);
      let answer: (value: Answer) => void = () => undefined;
      open.mockImplementationOnce(
        () =>
          new Promise<Answer>((resolve) => {
            answer = resolve;
          }),
      );

      const started = dialog.start();
      await new Promise((resolve) => setTimeout(resolve));
      const gated = dialog.gate();
      session.current.set(GARAGE);
      answer('signed-in');
      await started;

      await expect(gated).resolves.toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/app/garage');
    });

    it('opens a new dialog once the previous one has closed', async () => {
      const { dialog, open } = setup(null, 'cancelled', 'signed-in');

      await expect(dialog.gate()).resolves.toBe(false);
      await expect(dialog.gate()).resolves.toBe(true);
      expect(open).toHaveBeenCalledTimes(2);
    });
  });
});
