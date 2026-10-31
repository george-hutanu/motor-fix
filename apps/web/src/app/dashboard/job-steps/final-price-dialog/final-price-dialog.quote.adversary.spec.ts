import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const above = () => panel().querySelector('[data-above-quote]');
const range = () => text(panel().querySelector('[data-quote-range]'));
const quote = () => text(panel().querySelector('[data-quote]'));
void refused;
void alert;

// @traces 1410-FR-001
describe('the quote hint under the field', () => {
  it('shows one amount when the ends are equal', async () => {
    await open({ quoteFromBani: 120000, quoteToBani: 120000 });
    expect(range()).toBe('Ofertă 1.200 lei');
  });

  it('shows the range in English with a comma separator', async () => {
    await open({ language: 'en' });
    expect(range()).toBe('Quote 890–1,400 lei');
  });

  it('shows the hint on a pre-filled correction too', async () => {
    await open({ recorded: 100000 });
    expect(range()).toBe('Ofertă 890–1.400 lei');
  });

  it('shows the hint with a range of bani that are not whole lei', async () => {
    await open({ quoteFromBani: 89050, quoteToBani: 140001 });
    expect(range()).toBe('Ofertă 890,50–1.400,01 lei');
  });

  it('keeps the hint while an invalid text is typed', async () => {
    await open();
    await type('abc');
    expect(range()).toBe('Ofertă 890–1.400 lei');
  });

  it('makes no extra call to read the job', async () => {
    await open();
    await type('1.600');
    expect(handover).not.toHaveBeenCalled();
    expect(correct).not.toHaveBeenCalled();
    expect(reread).not.toHaveBeenCalled();
  });
});

// @traces 1410-FR-002
describe('Peste ofertă', () => {
  it('is absent on open with no text', async () => {
    await open();
    expect(above()).toBeNull();
  });

  it.each([
    ['1.600', true],
    ['1.400', false],
    ['1.400,00', false],
    ['1.399,99', false],
    ['1.400,01', true],
    ['1.400,50', true],
    ['1400', false],
    ['1401', true],
    ['  1.600  ', true],
    ['0', false],
    ['-1.600', false],
    ['abc', false],
    ['1.400,123', false],
    ['1.600,123', false],
    ['1.000.000,01', false],
    ['999.999', true],
    ['', false],
  ])('judges "%s" above the quote: %s', async (value, expected) => {
    await open();
    await type(value);
    expect(above() !== null).toBe(expected);
  });

  it('reads Above the quote in English beside the range', async () => {
    await open({ language: 'en' });
    await type('1.600');
    expect(text(above())).toBe('Above the quote');
    expect(quote()).toBe('Quote 890–1,400 leiAbove the quote');
  });

  it('reads Peste ofertă beside the range in Romanian', async () => {
    await open();
    await type('1.600');
    expect(quote()).toBe('Ofertă 890–1.400 leiPeste ofertă');
  });

  it('goes away when the text comes back down to the bound', async () => {
    await open();
    await type('1.600');
    expect(above()).not.toBeNull();
    await type('1.400');
    expect(above()).toBeNull();
  });

  it('goes away when the text is wiped', async () => {
    await open();
    await type('1.600');
    await type('');
    expect(above()).toBeNull();
  });

  it('comes back after an invalid text between two valid ones', async () => {
    await open();
    await type('1.600');
    await type('1.600,1234');
    expect(above()).toBeNull();
    await type('1.600');
    expect(above()).not.toBeNull();
  });

  it('shows at once on a correction pre-filled above the bound', async () => {
    await open({ recorded: 160000 });
    expect(above()).not.toBeNull();
  });

  it('is absent on a correction pre-filled at the bound', async () => {
    await open({ recorded: 140000 });
    expect(above()).toBeNull();
  });

  it('is absent on a correction pre-filled below the bound', async () => {
    await open({ recorded: 100000 });
    expect(above()).toBeNull();
  });

  it('judges against the upper bound when the ends are equal', async () => {
    await open({ quoteFromBani: 120000, quoteToBani: 120000 });
    await type('1.200');
    expect(above()).toBeNull();
    await type('1.200,01');
    expect(above()).not.toBeNull();
  });

  it('judges against the upper bound and not the lower one', async () => {
    await open();
    await type('900');
    expect(above()).toBeNull();
  });

  it('is not a second message for an amount above the maximum', async () => {
    await open({ quoteToBani: 140000 });
    await type('1.000.000,01');
    await button('Salvează').click();
    await settle();
    expect(above()).toBeNull();
    expect(text(panel())).toContain('Cel mult 1.000.000 lei.');
  });

  it('still saves 160000 bani and closes with the job', async () => {
    await open();
    await type('1.600');
    await save();
    expect(handover).toHaveBeenCalledTimes(1);
    expect(handover).toHaveBeenCalledWith({
      body: { finalPriceBani: 160000 },
      id: 'job-1',
    });
    await expect(result).resolves.toBe(answered);
  });

  it('saves a pre-filled correction above the bound without a second step', async () => {
    await open({ recorded: 160000 });
    await save();
    expect(correct).toHaveBeenCalledTimes(1);
    expect(correct).toHaveBeenCalledWith({
      body: { finalPriceBani: 160000 },
      id: 'job-1',
    });
  });

  it('shows the field message and no Peste ofertă for an invalid text on save', async () => {
    await open();
    await type('1.400,123');
    await save();
    expect(handover).not.toHaveBeenCalled();
    expect(above()).toBeNull();
    expect(text(panel())).toContain('Cel mult două zecimale');
  });

  it('judges a huge quote bound without rounding', async () => {
    await open({ quoteFromBani: 1, quoteToBani: 99999999 });
    await type('999.999,99');
    expect(above()).toBeNull();
    await type('1.000.000');
    expect(above()).not.toBeNull();
  });

  it('judges a zero bound: any positive amount is above', async () => {
    await open({ quoteFromBani: 0, quoteToBani: 0 });
    await type('0,01');
    expect(above()).not.toBeNull();
  });
});

// @traces 1410-FR-003
describe('the two labels', () => {
  const read = (file: string) =>
    JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../../../libs/i18n/src/garage', file),
        'utf8',
      ),
    );

  it('exist in both languages in the garage bundle', () => {
    expect(read('ro.json').jobs.finalPrice).toEqual(
      expect.objectContaining({
        aboveQuote: 'Peste ofertă',
        quote: 'Ofertă {range}',
      }),
    );
    expect(read('en.json').jobs.finalPrice).toEqual(
      expect.objectContaining({
        aboveQuote: 'Above the quote',
        quote: 'Quote {range}',
      }),
    );
  });

  it('are not in the first page bundle', () => {
    for (const file of ['ro.json', 'en.json']) {
      const shell = join(
        __dirname,
        '../../../../../../../libs/i18n/src/shell',
        file,
      );
      expect(readFileSync(shell, 'utf8')).not.toMatch(/aboveQuote/);
    }
  });
});
