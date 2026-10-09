import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GaragesService, type PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { ReportGarage } from './report-garage';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const GARAGE = {
  id: 'g-dinamo',
  name: 'Atelier Dinamo',
  slug: 'atelier-dinamo',
} as PublicGarageDto;
const TEXT = 'Au cerut plata înainte și nu au reparat mașina.';

let send: jest.Mock;
let result: Promise<OverlayResult<unknown>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  send = jest.fn(async () => ({
    createdAt: '2026-10-09T10:00:00.000Z',
    id: 'report-1',
  }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: { garageReportsControllerReport: send },
      },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(ReportGarage, {
    data: { garage: GARAGE },
    shape: 'dialog',
    title: 'public.reportGarage.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const field = () =>
  panel().querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;
const text = () => (panel().textContent ?? '').replace(/\s+/g, ' ');

function type(value: string) {
  field().value = value;
  field().dispatchEvent(new Event('input', { bubbles: true }));
}

async function sendWith(error: HttpErrorResponse) {
  send.mockRejectedValueOnce(error);
  type(TEXT);
  button('Trimite raportarea')?.click();
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

// @traces 312-FR-002 312-FR-004
describe('the report of a garage', () => {
  it('asks what happened in a labelled field with its range and a live count', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Ce s‑a întâmplat?',
    );
    expect(panel().querySelector(`label[for="${field().id}"]`)).not.toBeNull();
    const described = (field().getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('20');
    expect(described).toContain('1000');
    expect(text()).toContain('0 / 1000');
    type('Au cerut plata înainte.');
    await settle();
    expect(text()).toContain('23 / 1000');
    expect(button('Trimite raportarea')?.type).toBe('submit');
  });

  it('speaks English', async () => {
    await open('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'What happened?',
    );
    expect(button('Send the report')).toBeDefined();
  });

  it('sends nothing for a text under 20 characters and says why under the field', async () => {
    await open();
    type('Prea scurt.');

    button('Trimite raportarea')?.click();
    await settle();

    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain('Scrie cel puțin 20 caractere.');
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('sends nothing for a text over 1000 characters', async () => {
    await open();
    type('a'.repeat(1001));

    button('Trimite raportarea')?.click();
    await settle();

    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain('Scrie cel mult 1000 caractere.');
  });

  it('sends the text as typed, once, and closes as sent', async () => {
    await open();
    let answer!: (value: unknown) => void;
    send.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    type(`  ${TEXT}  `);

    button('Trimite raportarea')?.click();
    await settle();
    button('Trimite raportarea')?.click();
    await settle();
    answer({ createdAt: '2026-10-09T10:00:00.000Z', id: 'report-1' });
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      body: { text: `  ${TEXT}  ` },
      id: GARAGE.id,
    });
    await expect(result).resolves.toBe('sent');
  });

  it('keeps the text and offers to try again when the network fails', async () => {
    await open();

    await sendWith(new HttpErrorResponse({ status: 0 }));

    expect(field().value).toBe(TEXT);
    expect(button('Încearcă din nou')).toBeDefined();
    send.mockResolvedValueOnce({ createdAt: '', id: 'report-1' });
    button('Încearcă din nou')?.click();
    await settle();
    await expect(result).resolves.toBe('sent');
  });

  it('offers to try again after a server error or an unexpected refusal', async () => {
    await open();

    await sendWith(
      new HttpErrorResponse({ error: { code: 'internal_error' }, status: 500 }),
    );
    expect(field().value).toBe(TEXT);
    expect(button('Încearcă din nou')).toBeDefined();

    await sendWith(
      new HttpErrorResponse({ error: { code: 'forbidden' }, status: 403 }),
    );
    expect(field().value).toBe(TEXT);
    expect(button('Încearcă din nou')).toBeDefined();
  });

  it('says the driver already reported this garage and keeps the text', async () => {
    await open();

    await sendWith(
      new HttpErrorResponse({
        error: { code: 'garage_already_reported' },
        status: 409,
      }),
    );

    expect(text()).toContain('Ai raportat deja acest service.');
    expect(field().value).toBe(TEXT);
    expect(button('Încearcă din nou')).toBeUndefined();
  });

  it('says there were too many reports, to try later', async () => {
    await open();

    await sendWith(
      new HttpErrorResponse({
        error: { code: 'too_many_reports' },
        status: 429,
      }),
    );

    expect(text()).toContain(
      'Ai trimis prea multe raportări. Încearcă mai târziu.',
    );
    expect(button('Încearcă din nou')).toBeUndefined();
  });

  it('says the refusals in English', async () => {
    await open('en');

    send.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { code: 'garage_already_reported' },
        status: 409,
      }),
    );
    type(TEXT);
    button('Send the report')?.click();
    await settle();

    expect(text()).toContain('You have already reported this garage.');
  });

  it('closes as gone, with no message, when the garage cannot be reported', async () => {
    await open();

    await sendWith(
      new HttpErrorResponse({ error: { code: 'not_found' }, status: 404 }),
    );

    await expect(result).resolves.toBe('gone');
  });
});
