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

const base: CarDto = {
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

let remove: jest.Mock;
let result: Promise<OverlayResult<true>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  car: CarDto = base,
  answer: () => Promise<void> = async () => undefined,
) {
  remove = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      { provide: CarsService, useValue: { carsControllerRemove: remove } },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  const host = TestBed.createComponent(Host);
  result = openRemoveCar(host.componentInstance.overlays, car);
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const body = () => panel().querySelector('mf-remove-car') as HTMLElement;
const button = (name: string) =>
  [...body().querySelectorAll('button')].find((b) =>
    b.textContent?.includes(name),
  ) as HTMLButtonElement;
const alert = () => body().querySelector('[role="alert"]')?.textContent ?? '';
const refusal = (status: number, error: unknown) =>
  new HttpErrorResponse({ error, status });

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 092-FR-011
describe('the removal confirmation under hostile names', () => {
  it('shows a name with markup as text', async () => {
    await open({
      ...base,
      brandName: '<b>Mini</b>',
      model: '<img src=x onerror=alert(1)>',
    });

    expect(body().textContent).toContain(
      'Ștergi <b>Mini</b> <img src=x onerror=alert(1)>?',
    );
    expect(body().querySelector('img')).toBeNull();
    expect(body().querySelector('b')).toBeNull();
  });

  it('names a car with a very long model without losing the buttons', async () => {
    await open({ ...base, model: 'x'.repeat(40) });

    expect(body().textContent).toContain(`Mini ${'x'.repeat(40)}?`);
    expect(button('Șterge mașina')).toBeDefined();
    expect(button('Renunță')).toBeDefined();
  });

  it('names a car with unicode letters as they are', async () => {
    await open({ ...base, brandName: 'Škoda', model: 'Fabia Ș' });

    expect(body().textContent).toContain('Ștergi Škoda Fabia Ș?');
  });
});

// @traces 092-FR-011
describe('the removal confirmation under failure', () => {
  it('shows the shared reason for a network failure, and stays open', async () => {
    await open(base, async () => {
      throw refusal(0, new ProgressEvent('error'));
    });

    button('Șterge mașina').click();
    await settle();

    expect(alert()).not.toBe('');
    expect(body().isConnected).toBe(true);
    expect(button('Șterge mașina').getAttribute('aria-busy')).not.toBe('true');
  });

  it('shows the shared reason when the refusal body is not an object', async () => {
    await open(base, async () => {
      throw refusal(409, 'plain text');
    });

    button('Șterge mașina').click();
    await settle();

    expect(alert()).not.toContain('open_request');
    expect(alert()).not.toBe('');
    expect(body().isConnected).toBe(true);
  });

  it('shows the open-request reason and not the not-found one for a 409', async () => {
    await open(base, async () => {
      throw refusal(409, { code: 'open_request', title: 'open' });
    });

    button('Șterge mașina').click();
    await settle();

    expect(alert()).toContain('Mașina are o cerere deschisă.');
    expect(alert()).not.toContain('Nu mai găsim');
  });

  it('still closes with cancelled after a refusal, sending no second request', async () => {
    await open(base, async () => {
      throw refusal(409, { code: 'open_request', title: 'open' });
    });
    button('Șterge mașina').click();
    await settle();

    button('Renunță').click();

    expect(await result).toBe('cancelled');
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('closes with cancelled on Escape without removing the car', async () => {
    await open();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(remove).not.toHaveBeenCalled();
    expect(await Promise.race([result, Promise.resolve('open')])).toBe(
      'cancelled',
    );
  });

  it('clears the old reason when a second try goes through', async () => {
    let calls = 0;
    await open(base, async () => {
      calls += 1;
      if (calls === 1)
        throw refusal(409, { code: 'open_request', title: 'open' });
    });
    button('Șterge mașina').click();
    await settle();
    expect(alert()).toContain('cerere deschisă');

    button('Șterge mașina').click();
    await settle();

    expect(await result).toBe(true);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenLastCalledWith({ id: 'car-mini' });
  });
});
