import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { HealthService, type MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { SignInReturn } from './sign-in-return';
import { Session } from '../../dashboard/session';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

const DRIVER = { landing: '/app/driver' } as MeDto;

function setup(
  query: Record<string, string>,
  {
    me = DRIVER as MeDto | null,
    returned = false,
    returnTo = null as string | null,
    platform = 'browser',
  } = {},
) {
  const session = {
    current: jest.fn(() => me),
    load: jest.fn(async () => me),
    takeReturnTo: jest.fn(() => returnTo),
  };
  const dialog = { returned: jest.fn(async () => returned) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platform },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
      },
      { provide: Session, useValue: session },
      { provide: SignInDialog, useValue: dialog },
      {
        provide: HealthService,
        useValue: { healthControllerReady: jest.fn(async () => null) },
      },
    ],
  });
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(SignInReturn);
  return { dialog, fixture, navigate, session };
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r));
};

describe('the return from a provider', () => {
  it('opens the dashboard of the role in use after a sign-in', async () => {
    const { dialog, fixture, navigate } = setup({
      provider: 'google',
      result: 'signed-in',
    });
    fixture.detectChanges();
    await flush();

    expect(fixture.nativeElement.querySelector('mf-home')).not.toBeNull();
    expect(navigate).toHaveBeenCalledWith('/app/driver', { replaceUrl: true });
    expect(dialog.returned).not.toHaveBeenCalled();
  });

  it('goes back to the screen whose action asked for the sign-in', async () => {
    const { fixture, navigate } = setup(
      { provider: 'google', result: 'signed-in' },
      { returnTo: '/ro/garages/g-1' },
    );
    fixture.detectChanges();
    await flush();

    expect(navigate).toHaveBeenCalledWith('/ro/garages/g-1', {
      replaceUrl: true,
    });
  });

  it.each([
    'consent',
    'cancelled',
    'failed',
    'maintenance',
    'suspended',
    'email_taken',
  ])('hands "%s" to the sign-in dialog, with the provider', async (result) => {
    const { dialog, fixture } = setup({ provider: 'apple', result });
    fixture.detectChanges();
    await flush();

    expect(dialog.returned).toHaveBeenCalledWith(result, 'apple');
  });

  it('reads an unknown result or provider as a failure with Google', async () => {
    const { dialog, fixture } = setup({
      provider: 'facebook',
      result: '<script>',
    });
    fixture.detectChanges();
    await flush();

    expect(dialog.returned).toHaveBeenCalledWith('failed', 'google');
  });

  it('reads a sign-in the cookie does not hold as a failure', async () => {
    const { dialog, fixture } = setup(
      { provider: 'google', result: 'signed-in' },
      { me: null },
    );
    fixture.detectChanges();
    await flush();

    expect(dialog.returned).toHaveBeenCalledWith('failed', 'google');
  });

  it('leaves the address for Home when the dialog closes without a sign-in', async () => {
    const { fixture, navigate } = setup(
      { provider: 'google', result: 'cancelled' },
      { me: null },
    );
    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();
    await flush();

    expect(navigate).toHaveBeenCalledWith('/en', { replaceUrl: true });
  });

  it('opens the dashboard when the person signs in from the dialog', async () => {
    const { fixture, navigate } = setup(
      { provider: 'google', result: 'consent' },
      { returned: true },
    );
    fixture.detectChanges();
    await flush();

    expect(navigate).toHaveBeenCalledWith('/app/driver', { replaceUrl: true });
  });

  it('does nothing on the server', async () => {
    const { dialog, fixture, session } = setup(
      { provider: 'google', result: 'signed-in' },
      { platform: 'server' },
    );
    fixture.detectChanges();
    await flush();

    expect(session.load).not.toHaveBeenCalled();
    expect(dialog.returned).not.toHaveBeenCalled();
  });
});
