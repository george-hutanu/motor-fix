import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { GaragesService, type PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { RequestSavedQuote } from './request-saved-quote';
import { Consent } from '../../../consent/consent';
import { Voice } from '../../../voice/voice';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: Object.assign(
    jest.fn(() => 'bar'),
    { dismiss: jest.fn() },
  ),
}));

const GARAGE = {
  id: 'garage-1',
  jobTypes: [],
  name: 'Atelier Dinamo',
  slug: 'atelier-dinamo',
  worksOn: [],
} as unknown as PublicGarageDto;

const failure = (status: number) =>
  new HttpErrorResponse({ error: { status }, status });

let read: jest.Mock;
let open: jest.Mock;
let track: jest.Mock;

async function render(
  options: {
    answer?: unknown;
    read?: () => Promise<PublicGarageDto>;
    language?: 'ro' | 'en';
    slug?: string;
    name?: string;
  } = {},
) {
  read = jest.fn(options.read ?? (async () => GARAGE));
  open = jest.fn(async () => options.answer ?? 'cancelled');
  track = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: GaragesService,
        useValue: { publicGaragesControllerBySlug: read },
      },
      { provide: Overlays, useValue: { open } },
      { provide: Consent, useValue: { track } },
      { provide: Voice, useValue: { voice: 3 } },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('driver');
  await i18n.enter('public');
  if (options.language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(RequestSavedQuote);
  fixture.componentRef.setInput('slug', options.slug ?? 'atelier-dinamo');
  fixture.componentRef.setInput('name', options.name ?? 'Atelier Dinamo');
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const button = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('button[data-quote]');

async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  }
}

afterEach(() => {
  TestBed.resetTestingModule();
  jest.mocked(toast).mockClear();
});

// @traces 292-FR-001
describe('Cere ofertă under attack: the name', () => {
  it('puts a garage name with markup into the accessible name as text', async () => {
    const { host } = await render({
      name: '<img src=x onerror=alert(1)> & Co',
    });

    expect(button(host)?.getAttribute('aria-label')).toBe(
      'Cere ofertă de la <img src=x onerror=alert(1)> & Co',
    );
    expect(host.querySelector('img')).toBeNull();
  });

  it('keeps unicode and a name with braces intact in the accessible name', async () => {
    const { host } = await render({
      language: 'en',
      name: 'Șoșoacă {garage} Ț',
    });

    expect(button(host)?.getAttribute('aria-label')).toBe(
      'Request a quote from Șoșoacă {garage} Ț',
    );
  });

  it('renders an empty name without the word undefined', async () => {
    const { host } = await render({ name: '' });

    expect(button(host)?.getAttribute('aria-label')).not.toContain('undefined');
  });
});

// @traces 292-FR-004
describe('Cere ofertă under attack: the read and the dialog', () => {
  it('reads the slug it was given verbatim, even with a slash or a question mark', async () => {
    const { host } = await render({ slug: 'a/b?c=d é' });

    button(host)?.click();
    await settle();

    expect(read.mock.calls[0][0]).toEqual({ slug: 'a/b?c=d é' });
  });

  it('opens one dialog when the button is tapped again while the dialog stays open', async () => {
    let close: (value: string) => void = () => undefined;
    const { host } = await render();
    open.mockImplementation(() => new Promise((resolve) => (close = resolve)));

    button(host)?.click();
    await settle();
    button(host)?.click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    close('cancelled');
  });

  it('opens the dialog again on a later tap after a cancelled one', async () => {
    const { host } = await render();

    button(host)?.click();
    await settle();
    button(host)?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('does not navigate when the dialog closes after sending', async () => {
    const { host } = await render({ answer: { id: 'req-1' } });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    button(host)?.click();
    await settle();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the button usable and shows the shared error when the dialog itself fails to open', async () => {
    const { host } = await render();
    open.mockRejectedValue(new Error('overlay broke'));

    button(host)?.click();
    await settle();

    expect(toast).toHaveBeenCalledWith('Nu a mers. Încearcă din nou.');
    expect(button(host)?.getAttribute('aria-busy')).toBeNull();
    expect(button(host)?.getAttribute('aria-disabled')).toBeNull();
  });
});

// @traces 292-FR-007
describe('Cere ofertă under attack: failures', () => {
  it.each([400, 401, 403, 429, 500, 503])(
    'toasts the shared error and stays a button on status %i',
    async (status) => {
      const { host } = await render({
        read: () => Promise.reject(failure(status)),
      });

      button(host)?.click();
      await settle();

      expect(open).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith('Nu a mers. Încearcă din nou.');
      expect(button(host)).not.toBeNull();
    },
  );

  // A failure with no HTTP answer is a failed connection (httpStatus gives 0).
  it('says no connection for a thrown plain Error, which got no answer', async () => {
    const { host } = await render({
      read: () => Promise.reject(new Error('boom')),
    });

    button(host)?.click();
    await settle();

    expect(toast).toHaveBeenCalledWith('Fără conexiune');
    expect(button(host)).not.toBeNull();
  });

  it('says no connection for a rejection with undefined, which got no answer', async () => {
    const { host } = await render({ read: () => Promise.reject(undefined) });

    button(host)?.click();
    await settle();

    expect(toast).toHaveBeenCalledWith('Fără conexiune');
    expect(button(host)).not.toBeNull();
  });

  it('says no connection in English for an English reader', async () => {
    const { host } = await render({
      language: 'en',
      read: () => Promise.reject(failure(0)),
    });

    button(host)?.click();
    await settle();

    expect(toast).toHaveBeenCalledWith('No connection');
  });

  it('says Unavailable in English with no toast on a 404', async () => {
    const { host } = await render({
      language: 'en',
      read: () => Promise.reject(failure(404)),
    });

    button(host)?.click();
    await settle();

    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Unavailable',
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it('recovers from a failed read: a second tap reads again and opens the dialog', async () => {
    const { host } = await render();
    read.mockRejectedValueOnce(failure(500));

    button(host)?.click();
    await settle();
    button(host)?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('stays unavailable and makes no further read once the garage was gone', async () => {
    const { fixture, host } = await render({
      read: () => Promise.reject(failure(404)),
    });

    button(host)?.click();
    await settle();
    fixture.detectChanges();

    expect(button(host)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('opens nothing when the row is destroyed while the profile is read', async () => {
    let answer: (garage: PublicGarageDto) => void = () => undefined;
    const { fixture, host } = await render({
      read: () => new Promise((resolve) => (answer = resolve)),
    });

    button(host)?.click();
    fixture.destroy();
    answer(GARAGE);
    await settle();

    expect(open).not.toHaveBeenCalled();
  });
});

// @traces 292-FR-010
describe('Cere ofertă under attack: the analytics event', () => {
  it('sends the started event exactly once for one tap, with source saved', async () => {
    const { host } = await render();

    button(host)?.click();
    await settle();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('quote_request_started', {
      source: 'saved',
      voice: 3,
    });
  });

  it('sends the started event once for two quick taps', async () => {
    const { host } = await render({ read: () => new Promise(() => undefined) });

    button(host)?.click();
    button(host)?.click();
    await settle();

    expect(track).toHaveBeenCalledTimes(1);
  });

  it('sends no other event than quote_request_started', async () => {
    const { host } = await render({
      read: () => Promise.reject(failure(500)),
    });

    button(host)?.click();
    await settle();

    expect(track.mock.calls.map((call) => call[0])).toEqual([
      'quote_request_started',
    ]);
  });
});
