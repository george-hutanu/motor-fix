import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ReceiveJobDto } from './jobs.dto';

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
