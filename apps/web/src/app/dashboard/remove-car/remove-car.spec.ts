import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { openRemoveCar } from './open-remove-car';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const mini: CarDto = {
  brandId: 'mini',
  brandName: 'Mini',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'petrol',
  id: 'car-mini',
  itpUntil: null,
  model: 'Cooper S',
  odometerKm: 61000,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  updatedAt: '2026-10-07T09:00:00.000Z',
  year: 2017,
};

const refusal = (status: number, body: object) =>
  new HttpErrorResponse({ error: body, status });

let remove: jest.Mock;
let result: Promise<OverlayResult<true>>;

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
  remove = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      { provide: CarsService, useValue: { carsControllerRemove: remove } },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = openRemoveCar(host.componentInstance.overlays, mini);
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const body = () => panel().querySelector('mf-remove-car') as HTMLElement;
const buttons = () =>
  [...body().querySelectorAll('button')].map((b) => b.textContent?.trim());
const button = (name: string) =>
  [...body().querySelectorAll('button')].find((b) =>
    b.textContent?.includes(name),
  ) as HTMLButtonElement;
const alert = () => body().querySelector('[role="alert"]')?.textContent ?? '';

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 092-FR-011
describe('the removal confirmation', () => {
  it('names the car, says what happens and offers the two buttons', async () => {
    await open();

    expect(body().textContent).toContain(
      'Ștergi Mini Cooper S? Nu mai primești amintiri pentru ea.',
    );
    expect(buttons()).toEqual(['Renunță', 'Șterge mașina']);
  });

  it('reads English', async () => {
    await open('en');

    expect(body().textContent).toContain(
      'Remove the Mini Cooper S? You will get no more reminders for it.',
    );
    expect(buttons()).toEqual(['Cancel', 'Remove the car']);
  });

  it('removes the car and closes with true', async () => {
    await open();

    button('Șterge mașina').click();
    await settle();

    expect(remove).toHaveBeenCalledWith({ id: 'car-mini' });
    expect(await result).toBe(true);
  });

  it('shows the button busy while the removal is on its way, and sends once', async () => {
    let answer: () => void = () => undefined;
    await open(
      'ro',
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );

    button('Șterge mașina').click();
    await settle();
    expect(button('Șterge mașina').getAttribute('aria-busy')).toBe('true');
    button('Șterge mașina').click();
    await settle();
    expect(remove).toHaveBeenCalledTimes(1);

    answer();
    expect(await result).toBe(true);
  });

  it('closes with cancelled on "Renunță", removing nothing', async () => {
    await open();

    button('Renunță').click();

    expect(await result).toBe('cancelled');
    expect(remove).not.toHaveBeenCalled();
  });
});

// @traces 092-FR-014
describe('a refused removal', () => {
  it('shows the open request inside the dialog, which stays open', async () => {
    await open('ro', async () => {
      throw refusal(409, { code: 'open_request', title: 'open' });
    });

    button('Șterge mașina').click();
    await settle();

    expect(alert()).toContain(
      'Mașina are o cerere deschisă. Încheie sau anulează cererea mai întâi.',
    );
    expect(body().isConnected).toBe(true);
  });

  it('shows the open request in English', async () => {
    await open('en', async () => {
      throw refusal(409, { code: 'open_request', title: 'open' });
    });

    button('Remove the car').click();
    await settle();

    expect(alert()).toContain(
      'The car has an open request. Finish or cancel the request first.',
    );
  });

  it('shows any other refusal by its shared reason', async () => {
    await open('ro', async () => {
      throw refusal(404, { code: 'not_found', title: 'gone' });
    });

    button('Șterge mașina').click();
    await settle();

    expect(alert()).toContain(
      'Nu mai găsim ce voiai să salvezi. Reîncarcă pagina.',
    );
    expect(body().isConnected).toBe(true);
  });

  it('can be tried again after a refusal', async () => {
    let calls = 0;
    await open('ro', async () => {
      calls += 1;
      if (calls === 1) throw refusal(500, { code: 'error', title: 'boom' });
    });

    button('Șterge mașina').click();
    await settle();
    expect(alert()).toContain('Ceva nu a mers. Încearcă din nou.');

    button('Șterge mașina').click();
    await settle();

    expect(await result).toBe(true);
  });
});
