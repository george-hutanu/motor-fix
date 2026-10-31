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
  quoteFromBani = 89000,
  quoteToBani = 140000,
  recorded = null,
}: {
  language?: 'ro' | 'en';
  quoteFromBani?: number;
  quoteToBani?: number;
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
      data: { jobId: 'job-1', quoteFromBani, quoteToBani, recorded, reread },
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

// @traces 1393-FR-002
// @traces 1393-FR-003
// @traces 1393-FR-005
// @traces 1393-FR-017
describe('the Predare dialog', () => {
  it('holds one labelled lei field and the two buttons', async () => {
    await open();

    const label = panel().querySelector(`label[for="${field().id}"]`);
    expect(text(label)).toBe('Preț final (lei)');
    expect(field().getAttribute('inputmode')).toBe('decimal');
    expect(field().value).toBe('');
    expect(button('Salvează')).toBeDefined();
    expect(button('Renunță')).toBeDefined();
  });

  it('reads in English', async () => {
    await open({ language: 'en' });

    expect(text()).toContain('Final price (lei)');
    expect([...panel().querySelectorAll('button')].map((b) => text(b))).toEqual(
      expect.arrayContaining(['Save', 'Cancel']),
    );
  });

  it.each([
    ['1.250,50', 125050],
    ['890', 89000],
    ['1250,5 lei', 125050],
  ])(
    'records "%s" as %d bani and closes with the answer',
    async (typed, bani) => {
      await open();
      await type(typed);
      await save();

      expect(handover).toHaveBeenCalledWith({
        body: { finalPriceBani: bani },
        id: 'job-1',
      });
      expect(correct).not.toHaveBeenCalled();
      await expect(result).resolves.toBe(answered);
    },
  );

  it.each([
    ['0', 'Suma trebuie să fie mai mare de 0.'],
    ['-5', 'Suma trebuie să fie mai mare de 0.'],
    ['1.000.000,01', 'Cel mult 1.000.000 lei.'],
    ['12,345', 'Cel mult două zecimale.'],
    ['abc', 'Scrie suma în lei, de exemplu 4.200 sau 4.200,50.'],
    ['', 'Scrie suma în lei, de exemplu 4.200 sau 4.200,50.'],
  ])(
    'sends nothing for "%s" and says why under the field',
    async (typed, why) => {
      await open();
      await type(typed);
      await save();

      expect(handover).not.toHaveBeenCalled();
      expect(field().getAttribute('aria-invalid')).toBe('true');
      const hint = panel().querySelector(
        `#${field().getAttribute('aria-describedby')?.split(' ')[0]}`,
      );
      expect(text(hint)).toBe(why);
    },
  );

  it('clears the message as the text changes', async () => {
    await open();
    await type('abc');
    await save();
    await type('890');

    expect(field().getAttribute('aria-invalid')).toBeNull();
  });

  it('disables the field and both buttons while the save runs', async () => {
    await open();
    let answer: (job: JobDto) => void = () => undefined;
    handover.mockImplementation(
      () => new Promise<JobDto>((resolve) => (answer = resolve)),
    );
    await type('890');
    await save();

    expect(field().matches(':disabled')).toBe(true);
    expect(button('Renunță').matches(':disabled')).toBe(true);
    // Its name now carries the sending line too.
    expect(
      panel()
        .querySelector('button[type="submit"]')
        ?.getAttribute('aria-disabled'),
    ).toBe('true');
    answer(answered);
    await settle();
    await expect(result).resolves.toBe(answered);
  });

  it('closes with cancelled on Renunță and sends nothing', async () => {
    await open();
    await type('890');
    button('Renunță').click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(handover).not.toHaveBeenCalled();
  });
});

// @traces 1393-FR-007
// @traces 1393-FR-017
describe('a refused handover', () => {
  it.each([
    [409, 'job_not_done', 'Marchează întâi lucrarea ca gata'],
    [409, 'already_handed_over', 'Prețul final a fost deja înregistrat'],
    [409, 'not_handed_over', 'Lucrarea nu a fost încă predată'],
  ])(
    'keeps the dialog and the text on %d %s, says why and re-reads the drawer',
    async (status, code, said) => {
      await open();
      handover.mockRejectedValue(refused(status, code));
      await type('1.250,50');
      await save();

      expect(panel()).not.toBeNull();
      expect(field().value).toBe('1.250,50');
      expect(alert()).toBe(said);
      expect(panel().querySelector('mf-task-error')?.getAttribute('role')).toBe(
        'alert',
      );
      expect(reread).toHaveBeenCalledTimes(1);
    },
  );

  it('words a 403 for the final price, without a re-read', async () => {
    await open();
    handover.mockRejectedValue(refused(403, 'forbidden'));
    await type('890');
    await save();

    expect(alert()).toBe(
      'Doar proprietarul și recepția înregistrează prețul final',
    );
    expect(reread).not.toHaveBeenCalled();
  });

  it('shows the shared form text for any other failure', async () => {
    await open();
    handover.mockRejectedValue(refused(500, 'internal_error'));
    await type('890');
    await save();

    expect(alert()).toBe('Ceva nu a mers la noi. Încearcă din nou.');
    expect(field().value).toBe('890');
    expect(reread).not.toHaveBeenCalled();
  });

  it('reads a refusal in English', async () => {
    await open({ language: 'en' });
    handover.mockRejectedValue(refused(409, 'already_handed_over'));
    await type('890');
    button('Save').click();
    await settle();

    expect(alert()).toBe('The final price is already recorded');
  });
});

// @traces 1393-FR-006
// @traces 1393-FR-007
// @traces 1393-FR-017
describe('the correction dialog', () => {
  it('starts from the recorded price in Romanian text', async () => {
    await open({ recorded: 125050 });

    expect(field().value).toBe('1.250,50');
  });

  it('starts from the Romanian text in English too', async () => {
    await open({ language: 'en', recorded: 125000 });

    expect(field().value).toBe('1.250');
  });

  it('sends the correction with the new amount', async () => {
    await open({ recorded: 125050 });
    await type('1.150');
    await save();

    expect(correct).toHaveBeenCalledWith({
      body: { finalPriceBani: 115000 },
      id: 'job-1',
    });
    expect(handover).not.toHaveBeenCalled();
    await expect(result).resolves.toBe(answered);
  });

  it('sends the same price again and closes on the answer', async () => {
    await open({ recorded: 125050 });
    await save();

    expect(correct).toHaveBeenCalledWith({
      body: { finalPriceBani: 125050 },
      id: 'job-1',
    });
    await expect(result).resolves.toBe(answered);
  });

  it('says the window has closed and re-reads the drawer', async () => {
    await open({ recorded: 125050 });
    correct.mockRejectedValue(refused(409, 'correction_window_closed'));
    await save();

    expect(alert()).toBe('Prețul final nu mai poate fi corectat');
    expect(reread).toHaveBeenCalledTimes(1);
  });
});

const quote = () => text(panel().querySelector('[data-quote-range]'));
const above = () => panel().querySelector('[data-above-quote]');

// @traces 1410-FR-001
// @traces 1410-FR-002
// @traces 1410-FR-003
// @traces 1410-FR-005
describe('the accepted quote under the field', () => {
  it('shows the quote the driver accepted, in Romanian', async () => {
    await open();

    expect(quote()).toBe('Ofertă 890–1.400 lei');
    expect(above()).toBeNull();
  });

  it('shows the quote in English', async () => {
    await open({ language: 'en' });

    expect(quote()).toBe('Quote 890–1,400 lei');
  });

  it('reads one amount when the two ends are equal', async () => {
    await open({ quoteFromBani: 120000, quoteToBani: 120000 });

    expect(quote()).toBe('Ofertă 1.200 lei');
  });

  it('is named by the field', async () => {
    await open();

    const named = field().getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(named).toContain(panel().querySelector('[data-quote]')?.id);
  });

  it.each(['1.600', '1.400,01', '1.400,50', '14000'])(
    'warns "Peste ofertă" while "%s" is above the quote',
    async (typed) => {
      await open();
      await type(typed);

      expect(text(above())).toBe('Peste ofertă');
    },
  );

  it.each(['1.400', '1.399,99', '890', '500'])(
    'does not warn at or below the quote: "%s"',
    async (typed) => {
      await open();
      await type(typed);

      expect(above()).toBeNull();
    },
  );

  it('judges an equal-ends quote against its one amount', async () => {
    await open({ quoteFromBani: 120000, quoteToBani: 120000 });
    await type('1.200');
    expect(above()).toBeNull();
    await type('1.200,01');
    expect(text(above())).toBe('Peste ofertă');
  });

  it('drops the warning when the text goes back under the quote', async () => {
    await open();
    await type('1.600');
    await type('1.300');

    expect(above()).toBeNull();
  });

  it.each(['abc', '1.400,123', '1.000.000,01', ''])(
    'shows only the field message for "%s"',
    async (typed) => {
      await open();
      await type(typed);
      await save();

      expect(above()).toBeNull();
      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(handover).not.toHaveBeenCalled();
    },
  );

  it('warns in English', async () => {
    await open({ language: 'en' });
    await type('1.600');

    expect(text(above())).toBe('Above the quote');
  });

  it('still saves an amount above the quote, with no second step', async () => {
    await open();
    await type('1.600');
    await save();

    expect(handover).toHaveBeenCalledWith({
      body: { finalPriceBani: 160000 },
      id: 'job-1',
    });
    await expect(result).resolves.toBe(answered);
  });

  it('warns at once on a correction pre-filled above the quote', async () => {
    await open({ recorded: 150000 });

    expect(quote()).toBe('Ofertă 890–1.400 lei');
    expect(text(above())).toBe('Peste ofertă');
  });

  it('does not warn on a correction pre-filled within the quote', async () => {
    await open({ recorded: 125050 });

    expect(above()).toBeNull();
  });
});
