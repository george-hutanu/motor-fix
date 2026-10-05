import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NotificationsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { Unsubscribe } from './unsubscribe';

const TOKEN = '0b9d6a52-6f3e-4d55-9a57-2f1a3c1b7e10.c2lnbmF0dXJl';

let stop: jest.Mock;

async function open(
  options: { language?: 'ro' | 'en'; platform?: 'browser' | 'server' } = {},
) {
  stop ??= jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: Unsubscribe, path: ':lang/unsubscribe/:token' },
      ]),
      {
        provide: NotificationsService,
        useValue: { newsControllerUnsubscribe: stop },
      },
      { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (options.language === 'en') await i18n.use('en');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(
    `/${options.language ?? 'ro'}/unsubscribe/${TOKEN}`,
  );
  await settle(harness);
  return harness;
}

async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 4; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }
}

const text = (harness: RouterTestingHarness) =>
  (harness.routeNativeElement?.textContent ?? '').replace(/\s+/g, ' ').trim();

const button = (harness: RouterTestingHarness, name: string) =>
  [...(harness.routeNativeElement?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === name,
  );

beforeEach(() => {
  stop = undefined as unknown as jest.Mock;
});

describe('Unsubscribe', () => {
  it('stops the news the link was made for at once, with no click, and says so', async () => {
    const harness = await open();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith({ token: TOKEN });
    expect(text(harness)).toContain('Nu vei mai primi noutăți MotorFix');
    expect(
      harness.routeNativeElement?.querySelector('a')?.getAttribute('href'),
    ).toBe('/ro');
  });

  it('says it in English on the English address', async () => {
    const harness = await open({ language: 'en' });

    expect(text(harness)).toContain('You will no longer get MotorFix news');
  });

  it('shows the busy state until the answer arrives', async () => {
    stop = jest.fn(() => new Promise(() => undefined));
    const harness = await open();

    expect(text(harness)).toContain('Oprim noutățile…');
    expect(
      harness.routeNativeElement?.querySelector('[aria-busy="true"]'),
    ).not.toBeNull();
  });

  it('does not stop anything while rendered on the server', async () => {
    const harness = await open({ platform: 'server' });

    expect(stop).not.toHaveBeenCalled();
    expect(text(harness)).toContain('Oprim noutățile…');
  });

  it('says the link is not valid when its signature is refused', async () => {
    stop = jest.fn(async () => {
      throw new HttpErrorResponse({
        error: { code: 'invalid_unsubscribe_link', status: 400 },
        status: 400,
      });
    });
    const harness = await open();

    expect(text(harness)).toContain('Linkul nu este valid');
    expect(button(harness, 'Încearcă din nou')).toBeUndefined();
  });

  it('offers to try again when the stop could not be done', async () => {
    stop = jest
      .fn()
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }))
      .mockResolvedValueOnce(undefined);
    const harness = await open();

    expect(text(harness)).toContain('Nu am putut opri noutățile acum.');
    button(harness, 'Încearcă din nou')?.click();
    await settle(harness);

    expect(stop).toHaveBeenCalledTimes(2);
    expect(text(harness)).toContain('Nu vei mai primi noutăți MotorFix');
  });
});
