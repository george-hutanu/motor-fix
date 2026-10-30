import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GarageJobsService, type JobDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { type FinalPriceData, FinalPriceDialog } from './final-price-dialog';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const answered = { finalPriceBani: 125050, id: 'job-1' } as JobDto;

let handover: jest.Mock;
let correct: jest.Mock;
let reread: jest.Mock;
let result: Promise<OverlayResult<JobDto>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({
  language = 'ro',
  recorded = null,
}: {
  language?: 'ro' | 'en';
  recorded?: number | null;
} = {}) {
  handover = jest.fn(async () => answered);
  correct = jest.fn(async () => answered);
  reread = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GarageJobsService,
        useValue: {
          jobStagesControllerCorrect: correct,
          jobStagesControllerHandover: handover,
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<JobDto, FinalPriceData>(
    FinalPriceDialog,
    {
      data: { jobId: 'job-1', recorded, reread },
      shape: 'dialog',
      title:
        recorded === null
          ? 'garage.jobs.finalPrice.handover'
          : 'garage.jobs.finalPrice.correctTitle',
    },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = (el: Element | null = panel()) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => text(b) === name,
  ) as HTMLButtonElement;
const field = () => panel().querySelector('input') as HTMLInputElement;
const type = async (value: string) => {
  field().value = value;
  field().dispatchEvent(new Event('input'));
  await settle();
};
const save = async () => {
  button('Salvează').click();
  await settle();
};
const alert = () => text(panel().querySelector('mf-task-error'));
const refused = (status: number, code: string) =>
  new HttpErrorResponse({ error: { code, message: code }, status });

afterEach(() => {
  document.querySelector('.cdk-overlay-container')?.remove();
  TestBed.resetTestingModule();
});

// @traces 1393-FR-003
describe('the Predare dialog and hostile amounts', () => {
  it.each([
    ['  890  ', 89000],
    ['1 250,50 lei', 125050],
    ['0,01', 1],
    ['1.000.000', 100_000_000],
    ['1.000.000,00 lei', 100_000_000],
    ['890 lei', 89000],
  ])('records "%s" as %d bani', async (typed, bani) => {
    await open();
    await type(typed);
    await save();

    expect(handover).toHaveBeenCalledWith({
      body: { finalPriceBani: bani },
      id: 'job-1',
    });
  });

  it.each([
    '0,00',
    '-0',
    '+',
    ',',
    '.',
    '1e3',
    'NaN',
    'Infinity',
    '٣٠',
    '１２３',
    '12,3,4',
    '1..250',
    '1.25',
    '1,250.50',
    '890 lei lei',
    '99999999999999999999',
    '<script>alert(1)</script>',
    '   ',
  ])('sends nothing for the text %j', async (typed) => {
    await open();
    await type(typed);
    await save();

    expect(handover).not.toHaveBeenCalled();
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('sends a ten thousand character number as nothing', async () => {
    await open();
    await type('9'.repeat(10_000));
    await save();

    expect(handover).not.toHaveBeenCalled();
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the above-maximum message and not the format message for 1.000.000,01', async () => {
    await open();
    await type('1.000.000,01');
    await save();

    expect(
      text(
        panel().querySelector(`#${field().getAttribute('aria-describedby')}`),
      ),
    ).toBe('Cel mult 1.000.000 lei.');
  });

  it('reads the invalid messages in English', async () => {
    await open({ language: 'en' });
    await type('12,345');
    button('Save').click();
    await settle();

    expect(handover).not.toHaveBeenCalled();
    expect(
      text(
        panel().querySelector(`#${field().getAttribute('aria-describedby')}`),
      ),
    ).toBe('Two decimals at most.');
  });

  it('sends once when Salvează is pressed twice while the call runs', async () => {
    await open();
    handover.mockImplementation(() => new Promise(() => undefined));
    await type('890');
    button('Salvează').click();
    button('Salvează').click();
    await settle();

    expect(handover).toHaveBeenCalledTimes(1);
  });

  it('saves on Enter in the field', async () => {
    await open();
    await type('890');
    field().form?.requestSubmit();
    await settle();

    expect(handover).toHaveBeenCalledTimes(1);
  });
});

// @traces 1393-FR-007
describe('the Predare dialog and hostile failures', () => {
  it('lets the person fix the amount and save again after a refusal', async () => {
    await open();
    handover.mockRejectedValueOnce(refused(409, 'job_not_done'));
    await type('890');
    await save();
    await type('900');
    await save();

    expect(handover).toHaveBeenCalledTimes(2);
    expect(handover).toHaveBeenLastCalledWith({
      body: { finalPriceBani: 90000 },
      id: 'job-1',
    });
    await expect(result).resolves.toBe(answered);
  });

  it.each([
    [400, 'validation_failed'],
    [500, 'internal_error'],
    [502, 'bad_gateway'],
    [409, 'something_new'],
  ])(
    'shows a shared text for %d %s and keeps the dialog',
    async (status, code) => {
      await open();
      handover.mockRejectedValue(refused(status, code));
      await type('890');
      await save();

      expect(alert()).not.toBe('');
      expect(alert()).not.toMatch(/garage\.jobs|shell\.form|_/);
      expect(field().value).toBe('890');
      expect(panel()).not.toBeNull();
    },
  );

  it('shows a shared text when the network is down', async () => {
    await open();
    handover.mockRejectedValue(
      new HttpErrorResponse({ error: new ProgressEvent('error'), status: 0 }),
    );
    await type('890');
    await save();

    expect(alert()).not.toMatch(/garage\.jobs|shell\.form/);
    expect(alert()).not.toBe('');
    expect(field().value).toBe('890');
  });

  it('shows a shared text when the call throws a plain error', async () => {
    await open();
    handover.mockRejectedValue(new Error('boom'));
    await type('890');
    await save();

    expect(alert()).not.toBe('');
    expect(alert()).not.toContain('boom');
  });

  it('shows a refusal that has no body', async () => {
    await open();
    handover.mockRejectedValue(
      new HttpErrorResponse({ error: null, status: 409 }),
    );
    await type('890');
    await save();

    expect(alert()).not.toBe('');
    expect(field().value).toBe('890');
  });

  it('words a 403 for the correction too', async () => {
    await open({ recorded: 125050 });
    correct.mockRejectedValue(refused(403, 'forbidden'));
    await save();

    expect(alert()).toBe(
      'Doar proprietarul și recepția înregistrează prețul final',
    );
  });

  it('says the job has not been handed over when the correction finds none', async () => {
    await open({ recorded: 125050 });
    correct.mockRejectedValue(refused(409, 'not_handed_over'));
    await save();

    expect(alert()).toBe('Lucrarea nu a fost încă predată');
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('says the job is not done when the correction finds it reopened', async () => {
    await open({ recorded: 125050 });
    correct.mockRejectedValue(refused(409, 'job_not_done'));
    await save();

    expect(alert()).toBe('Marchează întâi lucrarea ca gata');
  });

  it('reads the window refusal in English', async () => {
    await open({ language: 'en', recorded: 125050 });
    correct.mockRejectedValue(refused(409, 'correction_window_closed'));
    button('Save').click();
    await settle();

    expect(alert()).toBe('The final price can no longer be corrected');
  });

  it('re-enables the field and the buttons after a refusal', async () => {
    await open();
    handover.mockRejectedValue(refused(500, 'internal_error'));
    await type('890');
    await save();

    expect(field().matches(':disabled')).toBe(false);
    expect(button('Renunță').matches(':disabled')).toBe(false);
  });

  it('keeps the typed value when a refusal arrives after the person edited it', async () => {
    await open();
    handover.mockRejectedValue(refused(409, 'already_handed_over'));
    await type('1 250,50 lei');
    await save();

    expect(field().value).toBe('1 250,50 lei');
  });
});

// @traces 1393-FR-006
describe('the correction dialog and hostile recorded prices', () => {
  it.each([
    [1, '0,01'],
    [5, '0,05'],
    [100, '1'],
    [100_000_000, '1.000.000'],
    [99_999_999, '999.999,99'],
  ])('pre-fills %d bani as "%s"', async (bani, shown) => {
    await open({ recorded: bani });

    expect(field().value).toBe(shown);
  });

  it('sends back exactly what it pre-filled', async () => {
    await open({ recorded: 99_999_999 });
    await save();

    expect(correct).toHaveBeenCalledWith({
      body: { finalPriceBani: 99_999_999 },
      id: 'job-1',
    });
  });

  it('sends nothing when the pre-filled price is wiped', async () => {
    await open({ recorded: 125050 });
    await type('');
    await save();

    expect(correct).not.toHaveBeenCalled();
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });
});

// @traces 1393-FR-005
describe('the Predare dialog offline', () => {
  afterEach(() => window.dispatchEvent(new Event('online')));

  it('disables Salvează, says there is no connection and keeps the value', async () => {
    await open();
    await type('890');
    window.dispatchEvent(new Event('offline'));
    await settle();

    expect(button('Salvează').matches(':disabled')).toBe(true);
    expect(text()).toContain('Nu ești conectat');
    expect(field().value).toBe('890');
    button('Salvează').click();
    await settle();
    expect(handover).not.toHaveBeenCalled();
  });

  it('saves again once the connection is back', async () => {
    await open();
    await type('890');
    window.dispatchEvent(new Event('offline'));
    await settle();
    window.dispatchEvent(new Event('online'));
    await settle();
    await save();

    expect(handover).toHaveBeenCalledTimes(1);
  });
});
