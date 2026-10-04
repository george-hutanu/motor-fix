import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { SignInDialog } from './sign-in-dialog';
import { Session } from '../dashboard/session';

const GARAGE = { landing: '/app/garage' } as MeDto;

function setup(signedIn: MeDto | null, answer: 'signed-in' | 'cancelled') {
  const current = signal<MeDto | null>(signedIn);
  const session = {
    current,
    load: jest.fn(async () => current()),
  };
  const open = jest.fn(async () => {
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
