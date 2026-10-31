import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { openCancelTransfer } from './open-cancel-transfer';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const bmw: CarDto = {
  brandId: 'bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'diesel',
  id: 'car-1',
  itpUntil: null,
  model: '320d',
  nextServiceKm: null,
  odometerKm: 148200,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  serviceDueOn: null,
  transfer: { expiresAt: '2026-10-15T09:00:00.000Z', id: 't-1' },
  updatedAt: '2026-10-07T09:00:00.000Z',
  year: 2019,
};

const refusal = (status: number, body: object) =>
  new HttpErrorResponse({ error: body, status });

let cancel: jest.Mock;
let result: Promise<OverlayResult<boolean>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  language: 'ro' | 'en' = 'ro',
  answer: () => Promise<void> = async () => undefined,
) {
  cancel = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      { provide: CarsService, useValue: { carSaleControllerCancel: cancel } },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = openCancelTransfer(host.componentInstance.overlays, bmw);
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const body = () => panel().querySelector('mf-cancel-transfer') as HTMLElement;
const buttons = () =>
  [...body().querySelectorAll('button')].map((b) => b.textContent?.trim());
const button = (name: string) =>
  [...body().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement;
const alert = () => body().querySelector('[role="alert"]')?.textContent ?? '';

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 1392-FR-004 1392-FR-006
describe('the cancel confirmation', () => {
  it('asks under its title, says what happens and offers the two buttons', async () => {
    await open();

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(
      document
        .getElementById(dialog.getAttribute('aria-labelledby') ?? '')
        ?.textContent?.trim(),
    ).toBe('Anulezi transferul?');
    expect(body().textContent).toContain('Linkul trimis nu va mai funcționa.');
    expect(buttons()).toEqual(['Înapoi', 'Anulează transferul']);
  });

  it('reads English', async () => {
    await open('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Cancel the transfer?',
    );
    expect(body().textContent).toContain(
      'The link you sent will stop working.',
    );
    expect(buttons()).toEqual(['Back', 'Cancel the transfer']);
  });

  it('cancels the line’s transfer and closes with true', async () => {
    await open();

    button('Anulează transferul').click();
    await settle();

    expect(cancel).toHaveBeenCalledWith({ id: 'car-1', transferId: 't-1' });
    expect(await result).toBe(true);
  });

  it('closes with cancelled on Înapoi, cancelling nothing', async () => {
    await open();

    button('Înapoi').click();

    expect(await result).toBe('cancelled');
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'not_sent', 'Transferul nu mai este activ.'],
    [404, 'not_found', 'Nu mai găsim ce voiai să salvezi. Reîncarcă pagina.'],
    [500, 'error', 'Ceva nu a mers. Încearcă din nou.'],
  ])(
    'shows a %s %s refusal inside, staying open',
    async (status, code, text) => {
      await open('ro', async () => {
        throw refusal(status, { code, title: 'no' });
      });

      button('Anulează transferul').click();
      await settle();

      expect(alert()).toContain(text);
      expect(body().isConnected).toBe(true);
    },
  );

  it('shows the transfer no longer active in English', async () => {
    await open('en', async () => {
      throw refusal(409, { code: 'not_sent', title: 'no' });
    });

    button('Cancel the transfer').click();
    await settle();

    expect(alert()).toContain('The transfer is no longer active.');
  });
});
