import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { HealthService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ResetPassword } from './reset-password';
import { SignInDialog } from '../sign-in/sign-in-dialog';

const TOKEN = 'A'.repeat(43);

function setup(saved: boolean, platform = 'browser') {
  const newPassword = jest.fn(async () => saved);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platform },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: convertToParamMap({ token: TOKEN }) },
        },
      },
      { provide: SignInDialog, useValue: { newPassword } },
      {
        provide: HealthService,
        useValue: { healthControllerReady: jest.fn(async () => null) },
      },
    ],
  });
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(ResetPassword);
  return { fixture, navigate, newPassword };
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r));
};

// @traces 127-FR-011
describe('the reset link page', () => {
  it('shows Home and opens the new-password dialog over it for the token', async () => {
    const { fixture, newPassword } = setup(true);
    fixture.detectChanges();
    await flush();

    expect(fixture.nativeElement.querySelector('mf-home')).not.toBeNull();
    expect(newPassword).toHaveBeenCalledWith(TOKEN);
  });

  it('leaves the address for Home when the dialog closes without a new password', async () => {
    const { fixture, navigate } = setup(false);
    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();
    await flush();

    expect(navigate).toHaveBeenCalledWith('/en', { replaceUrl: true });
  });

  it('opens no dialog on the server', async () => {
    const { fixture, newPassword } = setup(true, 'server');
    fixture.detectChanges();
    await flush();

    expect(newPassword).not.toHaveBeenCalled();
  });
});
