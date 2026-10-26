import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QuoteRequestsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import {
  type CancelRequestData,
  CancelRequestDialog,
  type CancelRequestResult,
} from './cancel-request-dialog';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const DATA: CancelRequestData = {
  car: 'Dacia Logan 2017',
  requestId: 'req-1',
  what: 'Schimb ulei',
};

let cancel: jest.Mock;
let result: Promise<CancelRequestResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({
  data = DATA,
  language = 'ro',
}: {
  data?: CancelRequestData;
  language?: 'ro' | 'en';
} = {}) {
  cancel = jest.fn(async () => ({ id: 'req-1', status: 'closed' }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: QuoteRequestsService,
        useValue: { cancelRequestControllerCancel: cancel },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    CancelRequestResult,
    CancelRequestData
  >(CancelRequestDialog, {
    data,
    shape: 'dialog',
    title: 'driver.requests.cancelRequestDialog.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');
const buttons = () =>
  [...panel().querySelectorAll('button')].filter(
    (b) => !b.closest('header') && b.textContent?.trim(),
  );
const button = (name: string) =>
  buttons().find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === name) as
    | HTMLButtonElement
    | undefined;

const press = async (name = 'Anulează cererea') => {
  button(name)?.click();
  await settle();
};

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  (toast as unknown as jest.Mock).mockClear();
  jest.restoreAllMocks();
  TestBed.resetTestingModule();
});

// @traces 1385-FR-004
// @traces 1385-FR-006
describe('the cancel request dialog under hostile use', () => {
  it('sends one call when the confirm is clicked twice before the answer', async () => {
    await open();
    cancel.mockReturnValueOnce(new Promise(() => undefined));

    button('Anulează cererea')?.click();
    button('Anulează cererea')?.click();
    await settle();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  // The shared overlay contract (libs/overlays form.spec: "ignores an answer
  // that arrives after the task was closed"): Escape closes a task even mid
  // call, unasked when no field changed. The list is not left stale: the
  // server's request.cancelled event re-reads it (FR-008).
  it('closes on Escape while the call runs, as every task does, sending once', async () => {
    await open();
    let answer: (value: unknown) => void = () => undefined;
    cancel.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await press();

    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
    answer({ id: 'req-1', status: 'closed' });
    await settle();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('shows a car and jobs with markup as text, not as elements', async () => {
    await open({
      data: { car: '<b>Dacia</b>', requestId: 'req-1', what: '<img src=x>' },
    });

    expect(panel().querySelector('b')).toBeNull();
    expect(panel().querySelector('img')).toBeNull();
    expect(text()).toContain('<b>Dacia</b> · <img src=x>');
  });

  it('names only the car when the jobs are empty, with no stray separator', async () => {
    await open({
      data: { car: 'Dacia Logan 2017', requestId: 'req-1', what: '' },
    });

    expect(text()).toContain('Dacia Logan 2017');
    expect(text()).not.toContain('Dacia Logan 2017 ·');
  });

  it('sends the id it was given, even an odd one, untouched', async () => {
    await open({
      data: { car: 'x', requestId: 'a/b?c=1 ü', what: 'y' },
    });

    await press();

    expect(cancel).toHaveBeenCalledWith({ id: 'a/b?c=1 ü' });
  });

  it('keeps the dialog open on a lost connection (status 0)', async () => {
    await open();
    cancel.mockRejectedValueOnce(
      new HttpErrorResponse({ error: new ProgressEvent('error'), status: 0 }),
    );

    await press();

    expect(panel()).not.toBeNull();
    expect(toast).not.toHaveBeenCalled();
    expect(button('Anulează cererea')?.matches(':disabled')).toBe(false);
  });

  it('keeps the dialog open on a 403, which is not one of the ending answers', async () => {
    await open();
    cancel.mockRejectedValueOnce(
      refusal(403, { code: 'forbidden', status: 403 }),
    );

    await press();

    expect(panel()).not.toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it('closes on a 409 whose body has no code, with some text rather than none', async () => {
    await open();
    cancel.mockRejectedValueOnce(refusal(409, {}));

    await press();

    await expect(result).resolves.toBe('refused');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(typeof (toast as unknown as jest.Mock).mock.calls[0][0]).toBe(
      'string',
    );
  });
});
