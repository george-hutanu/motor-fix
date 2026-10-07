import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { SignInDialog } from './sign-in-dialog';
import { Session } from '../dashboard/session';

function setup(opts: {
  answer: unknown;
  landing?: string;
  kept: string | null;
  already?: boolean;
  signedInButNoSession?: boolean;
}) {
  const current = signal<MeDto | null>(null);
  const takeReturnTo = jest.fn(() => opts.kept);
  const open = jest.fn(async () => {
    if (opts.answer === 'signed-in' && !opts.signedInButNoSession) {
      current.set({ landing: opts.landing ?? '/app/driver' } as MeDto);
    }
    return opts.answer;
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Session,
        useValue: {
          current,
          load: jest.fn(async () =>
            opts.already ? { landing: '/app/garage' } : null,
          ),
          takeReturnTo,
        },
      },
      { provide: Overlays, useValue: { open } },
    ],
  });
  const router = TestBed.inject(Router);
  const navigateByUrl = jest
    .spyOn(router, 'navigateByUrl')
    .mockResolvedValue(true);
  return {
    dialog: TestBed.inject(SignInDialog),
    navigateByUrl,
    takeReturnTo,
  };
}

describe('the sign-in dialog and the kept address', () => {
  it('opens the kept address through the router after sign-in', async () => {
    const { dialog, navigateByUrl } = setup({
      answer: 'signed-in',
      kept: '/app/driver/cars?x=1#y',
    });

    await dialog.start();

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/app/driver/cars?x=1#y');
  });

  it('opens the landing when nothing was kept', async () => {
    const { dialog, navigateByUrl } = setup({
      answer: 'signed-in',
      kept: null,
    });

    await dialog.start();

    expect(navigateByUrl).toHaveBeenCalledWith('/app/driver');
  });

  it('opens nothing and still reads the kept address when the dialog closes', async () => {
    const { dialog, navigateByUrl, takeReturnTo } = setup({
      answer: 'cancelled',
      kept: '/app/driver/cars',
    });

    await dialog.start();

    expect(takeReturnTo).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('opens nothing when the dialog says signed in but no session exists', async () => {
    const { dialog, navigateByUrl } = setup({
      answer: 'signed-in',
      kept: '/app/driver/cars',
      signedInButNoSession: true,
    });

    await dialog.start();

    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('goes to the landing of a signed-in person and leaves a kept address alone', async () => {
    const { dialog, navigateByUrl, takeReturnTo } = setup({
      already: true,
      answer: 'signed-in',
      kept: '/app/driver/cars',
    });

    await dialog.start();

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/app/garage');
    expect(takeReturnTo).not.toHaveBeenCalled();
  });
});
