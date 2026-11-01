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
  forCar: CarDto = bmw,
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
  result = openCancelTransfer(host.componentInstance.overlays, forCar);
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const body = () => panel().querySelector('mf-cancel-transfer') as HTMLElement;
const button = (name: string) =>
  [...body().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement;
const alert = () => body().querySelector('[role="alert"]')?.textContent ?? '';

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 1392-FR-004 1392-FR-006
describe('the cancel confirmation under stress', () => {
  const pressEscape = () =>
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );

  it('sends one cancel for two quick taps and ignores Escape while it is on its way', async () => {
    let answer: () => void = () => undefined;
    await open(
      'ro',
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );

    button('Anulează transferul').click();
    button('Anulează transferul').click();
    pressEscape();
    await settle();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(document.querySelector('mf-cancel-transfer')).not.toBeNull();
    answer();
    expect(await result).toBe(true);
  });

  it('closes with cancelled on Escape when nothing is in flight', async () => {
    await open();

    pressEscape();

    expect(await result).toBe('cancelled');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels again after a refusal and closes on the second answer', async () => {
    let calls = 0;
    await open('ro', async () => {
      calls += 1;
      if (calls === 1) throw refusal(500, { code: 'error', title: 'no' });
    });
    button('Anulează transferul').click();
    await settle();
    expect(alert()).toContain('Ceva nu a mers. Încearcă din nou.');

    button('Anulează transferul').click();

    expect(await result).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('sends no cancel for a car that carries no transfer', async () => {
    await open('ro', async () => undefined, { ...bmw, transfer: null });

    button('Anulează transferul')?.click();
    await settle();

    expect(cancel).not.toHaveBeenCalledWith({
      id: 'car-1',
      transferId: undefined,
    });
  });

  it('shows a refusal with no body as the generic failure', async () => {
    await open('ro', async () => {
      throw new HttpErrorResponse({ error: null, status: 502 });
    });

    button('Anulează transferul').click();
    await settle();

    expect(alert()).toContain('Încearcă din nou.');
    expect(body().isConnected).toBe(true);
  });
});
