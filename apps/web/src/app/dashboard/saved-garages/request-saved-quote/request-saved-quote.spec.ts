import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { GaragesService, type PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { RequestSavedQuote } from './request-saved-quote';
import { Consent } from '../../../consent/consent';
import type {
  RequestQuoteData,
  RequestQuoteResult,
} from '../../../public/garage-profile/request-quote/request-quote';
import { PUBLIC_READ } from '../../../public-read';
import { Voice } from '../../../voice/voice';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: Object.assign(
    jest.fn(() => 'bar'),
    { dismiss: jest.fn() },
  ),
}));

const GARAGE = {
  brand: null,
  id: 'garage-1',
  jobTypes: [
    {
      id: 'job-pads',
      nameEn: 'Front brake pads',
      nameRo: 'Plăcuțe frână față',
    },
  ],
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
    answer?: RequestQuoteResult;
    read?: () => Promise<PublicGarageDto>;
    language?: 'ro' | 'en';
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
  fixture.componentRef.setInput('slug', 'atelier-dinamo');
  fixture.componentRef.setInput('name', 'Atelier Dinamo');
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const button = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('button[data-quote]');

async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  }
}

afterEach(() => {
  TestBed.resetTestingModule();
  jest.mocked(toast).mockClear();
});

// @traces 292-FR-001
// @traces 292-FR-004
// @traces 292-FR-008
// @traces 292-FR-010
describe('Cere ofertă on a saved garage', () => {
  it('is a secondary button named for the garage', async () => {
    const { host } = await render();

    const quote = button(host);
    expect(quote?.textContent?.trim()).toBe('Cere ofertă');
    expect(quote?.getAttribute('aria-label')).toBe(
      'Cere ofertă de la Atelier Dinamo',
    );
    expect(quote?.classList.contains('spartan-button-variant-secondary')).toBe(
      true,
    );
  });

  it('is named in English for an English reader', async () => {
    const { host } = await render({ language: 'en' });

    expect(button(host)?.textContent?.trim()).toBe('Request a quote');
    expect(button(host)?.getAttribute('aria-label')).toBe(
      'Request a quote from Atelier Dinamo',
    );
  });

  it('reads the garage’s public profile, then opens the profile’s request dialog with source saved', async () => {
    const { host } = await render();

    button(host)?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    const [params, context] = read.mock.calls[0];
    expect(params).toEqual({ slug: 'atelier-dinamo' });
    expect(context.get(PUBLIC_READ)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    const [task, options] = open.mock.calls[0] as [
      { name: string },
      { data: RequestQuoteData },
    ];
    expect(task.name).toContain('RequestQuote');
    expect(options).toMatchObject({
      shape: 'dialog',
      title: 'public.requestQuote.title',
    });
    expect(options.data).toEqual({ garage: GARAGE, source: 'saved' });
  });

  it('counts the start of a request from the saved list', async () => {
    const { host } = await render();

    button(host)?.click();
    await settle();

    expect(track).toHaveBeenCalledWith('quote_request_started', {
      source: 'saved',
      voice: 3,
    });
  });

  it('shows its pending state while the profile is read, keeps the focus and ignores a second tap', async () => {
    let answer: (garage: PublicGarageDto) => void = () => undefined;
    const { fixture, host } = await render({
      read: () => new Promise((resolve) => (answer = resolve)),
    });
    const quote = button(host) as HTMLButtonElement;
    quote.focus();

    quote.click();
    fixture.detectChanges();
    quote.click();
    fixture.detectChanges();

    expect(read).toHaveBeenCalledTimes(1);
    expect(quote.getAttribute('aria-busy')).toBe('true');
    expect(quote.getAttribute('aria-disabled')).toBe('true');
    expect(quote.disabled).toBe(false);
    expect(document.activeElement).toBe(quote);

    answer(GARAGE);
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    expect(quote.getAttribute('aria-busy')).toBeNull();
    expect(quote.getAttribute('aria-disabled')).toBeNull();
  });

  it('goes where a link in the dialog points once it has closed', async () => {
    const { host } = await render({ answer: { go: '/app/driver/requests' } });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    button(host)?.click();
    await settle();

    expect(navigate).toHaveBeenCalledWith('/app/driver/requests');
  });
});

// @traces 292-FR-007
describe('Cere ofertă when the garage cannot be read', () => {
  it.each([404, 410])(
    'shows Indisponibil in the button’s place, said politely, with no dialog and no toast (%i)',
    async (status) => {
      const { host } = await render({
        read: () => Promise.reject(failure(status)),
      });

      button(host)?.click();
      await settle();

      expect(open).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
      expect(button(host)).toBeNull();
      const said = host.querySelector('[role="status"]');
      expect(said?.textContent?.trim()).toBe('Indisponibil');
    },
  );

  it('says there is no connection and comes back when the read never got an answer', async () => {
    const { host } = await render({ read: () => Promise.reject(failure(0)) });

    button(host)?.click();
    await settle();

    expect(open).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Fără conexiune');
    expect(button(host)?.getAttribute('aria-disabled')).toBeNull();
    expect(button(host)?.getAttribute('aria-busy')).toBeNull();
  });

  it('shows the shared error text and comes back on any other failure', async () => {
    const { host } = await render({ read: () => Promise.reject(failure(500)) });

    button(host)?.click();
    await settle();

    expect(open).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Nu a mers. Încearcă din nou.');
    expect(button(host)).not.toBeNull();
    expect(button(host)?.getAttribute('aria-disabled')).toBeNull();
  });
});
