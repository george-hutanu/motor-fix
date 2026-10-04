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
  | { switchTo: 'sign-in' | 'sign-up'; email: string };

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
});
