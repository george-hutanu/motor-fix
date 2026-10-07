import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { SignInDialog } from './sign-in-dialog';
import { Session } from '../dashboard/session';

const GARAGE = { landing: '/app/garage' } as MeDto;

function setup(open: jest.Mock) {
  const current = signal<MeDto | null>(null);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Session,
        useValue: {
          current,
          keepShownWhile: <T>(open: Promise<T>) => open,
          load: jest.fn(),
          takeReturnTo: jest.fn((): string | null => null),
        },
      },
      { provide: Overlays, useValue: { open } },
    ],
  });
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  return { current, dialog: TestBed.inject(SignInDialog), navigate };
}

describe('SignInDialog gate, hostile cases', () => {
  it('rejects every caller waiting on a failing overlay and then opens a fresh dialog', async () => {
    const open = jest
      .fn()
      .mockRejectedValueOnce(new Error('overlay failed'))
      .mockResolvedValueOnce('cancelled');
    const { dialog } = setup(open);

    const first = dialog.gate();
    const second = dialog.gate();
    await expect(first).rejects.toThrow('overlay failed');
    await expect(second).rejects.toThrow('overlay failed');

    await expect(dialog.gate()).resolves.toBe(false);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('does not report a sign-in when the dialog says signed in but no account is loaded', async () => {
    const open = jest.fn().mockResolvedValue('signed-in');
    const { dialog } = setup(open);

    await expect(dialog.gate()).resolves.toBe(false);
  });

  it('does not navigate away after a gated sign-in', async () => {
    const open = jest.fn();
    const { current, dialog, navigate } = setup(open);
    open.mockImplementation(async () => {
      current.set(GARAGE);
      return 'signed-in';
    });

    await dialog.gate();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens the plain dialog without the reason after a gated dialog was closed', async () => {
    const open = jest.fn().mockResolvedValue('cancelled');
    const { dialog } = setup(open);

    await dialog.gate();
    await dialog.start();

    expect(open.mock.calls[1]?.[1]).toEqual({
      shape: 'dialog',
      title: 'public.signIn.title',
    });
  });
});
