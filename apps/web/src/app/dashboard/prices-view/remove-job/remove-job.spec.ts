import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GaragesService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import {
  RemoveJob,
  type RemoveJobData,
  type RemoveJobResult,
} from './remove-job';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const DATA: RemoveJobData = { garageId: 'garage-1', priceId: 'price-brakes' };

let remove: jest.Mock;
let result: Promise<RemoveJobResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  remove = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: { priceListControllerRemove: remove },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<RemoveJobResult, RemoveJobData>(
    RemoveJob,
    { data: DATA, shape: 'dialog', title: 'garage.prices.removeDialog.title' },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;
const press = async (name: string) => {
  button(name)?.click();
  await settle();
};

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

// @traces 1352-FR-006
describe('removing a job: the question', () => {
  it('asks whether to remove the job, says open requests and sent quotes stay, and offers Șterge and Renunță', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Ștergi lucrarea din listă?',
    );
    expect(text()).toContain(
      'Cererile deschise și ofertele trimise rămân. Șoferii noi nu vor mai vedea lucrarea.',
    );
    expect(button('Șterge')).toBeDefined();
    expect(button('Renunță')).toBeDefined();
  });

  it('reads in English', async () => {
    await open('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Remove the job from the list?',
    );
    expect(text()).toContain(
      'Open requests and sent quotes are kept. New drivers will no longer see the job.',
    );
    expect(button('Remove')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });
});

// @traces 1352-FR-006
describe('removing a job: the answer', () => {
  it('removes the job on Șterge and closes', async () => {
    await open();

    await press('Șterge');

    expect(remove).toHaveBeenCalledWith({
      garageId: 'garage-1',
      priceId: 'price-brakes',
    });
    await expect(result).resolves.toBe('removed');
  });

  it('closes with nothing sent on Renunță', async () => {
    await open();

    await press('Renunță');

    expect(remove).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });

  it('stays open with the error when the removal fails', async () => {
    await open();
    remove.mockRejectedValueOnce(
      new HttpErrorResponse({ error: { code: 'internal_error' }, status: 500 }),
    );

    await press('Șterge');

    expect(panel()).not.toBeNull();
    expect(text()).toContain('Ceva nu a mers la noi. Încearcă din nou.');
    expect(button('Șterge')?.disabled).toBe(false);
  });

  it('closes as removed when another session removed the job first', async () => {
    await open();
    remove.mockRejectedValueOnce(
      new HttpErrorResponse({ error: { code: 'not_found' }, status: 404 }),
    );

    await press('Șterge');

    await expect(result).resolves.toBe('removed');
  });
});
