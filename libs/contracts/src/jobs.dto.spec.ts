import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  FINAL_PRICE_CORRECTION_HOURS,
  FinalPriceDto,
  ReceiveJobDto,
} from './jobs.dto';

const errors = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(ReceiveJobDto, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });

// @traces 276-FR-008
describe('ReceiveJobDto', () => {
  it.each([0, 84_000, 2_000_000])('takes the reading %d', (odometerKm) => {
    expect(errors({ odometerKm })).toEqual([]);
  });

  it.each([[-1], [2_000_001], [1.5], ['12'], [null]])(
    'refuses the reading %j',
    (odometerKm) => {
      expect(errors({ odometerKm })).toEqual([
        expect.objectContaining({ property: 'odometerKm' }),
      ]);
    },
  );

  it('refuses a body without a reading', () => {
    expect(errors({})).toEqual([
      expect.objectContaining({ property: 'odometerKm' }),
    ]);
  });

  it('refuses a field it does not know', () => {
    expect(errors({ odometerKm: 1, receivedAt: '2026-10-26' })).toEqual([
      expect.objectContaining({ property: 'receivedAt' }),
    ]);
  });
});

const priceErrors = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(FinalPriceDto, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);

// @traces 406-FR-003 406-FR-005 406-FR-011
describe('FinalPriceDto', () => {
  it.each([1, 125_050, 100_000_000])('takes %d bani', (finalPriceBani) => {
    expect(priceErrors({ finalPriceBani })).toEqual([]);
  });

  it.each([[0], [-1], [1.5], [100_000_001], ['125000'], [null]])(
    'refuses %j bani',
    (finalPriceBani) => {
      expect(priceErrors({ finalPriceBani })).toEqual(['finalPriceBani']);
    },
  );

  it('refuses a body without a price, or with another field', () => {
    expect(priceErrors({})).toEqual(['finalPriceBani']);
    expect(priceErrors({ finalPriceBani: 100, note: 'x' })).toEqual(['note']);
  });

  it('lets a price be corrected for 48 hours', () => {
    expect(FINAL_PRICE_CORRECTION_HOURS).toBe(48);
  });
});
