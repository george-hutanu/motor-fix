import { FINAL_PRICE_CORRECTION_HOURS } from '@motor-fix/contracts/request-status';
import type { JobDto } from '@motor-fix/data-access';

import { finalPriceAction, JOB_KINDS } from './jobs';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-30T10:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const job = (
  status: JobDto['status'],
  handedOverAt: string | null = null,
): Pick<JobDto, 'status' | 'handedOverAt'> => ({ handedOverAt, status });

// @traces 1393-FR-001
// @traces 1393-FR-006
// @traces 1393-FR-008
// @traces 1393-FR-017
describe('the final price action a drawer offers', () => {
  it.each(['garage', 'receptionist'])(
    'offers %s the handover on a done job not yet handed over',
    (role) => {
      expect(finalPriceAction(job('done'), role, NOW)).toBe('handover');
    },
  );

  it.each(['to_do', 'in_work', 'paused', 'cancelled'] as const)(
    'offers no handover on a %s job',
    (status) => {
      expect(finalPriceAction(job(status), 'garage', NOW)).toBeNull();
    },
  );

  it.each(['garage', 'receptionist'])(
    'offers %s the correction until the window closes',
    (role) => {
      const inside = FINAL_PRICE_CORRECTION_HOURS * HOUR - 60_000;
      expect(finalPriceAction(job('done', ago(inside)), role, NOW)).toBe(
        'correct',
      );
      expect(finalPriceAction(job('done', ago(0)), role, NOW)).toBe('correct');
    },
  );

  it('offers nothing once the window has closed', () => {
    const closed = ago(FINAL_PRICE_CORRECTION_HOURS * HOUR);
    expect(finalPriceAction(job('done', closed), 'garage', NOW)).toBeNull();
    expect(
      finalPriceAction(job('done', ago(72 * HOUR)), 'receptionist', NOW),
    ).toBeNull();
  });

  it.each([
    ['a mechanic', 'mechanic'],
    ['no session', undefined],
  ])('offers %s nothing, whatever the job', (_who, role) => {
    expect(finalPriceAction(job('done'), role, NOW)).toBeNull();
    expect(finalPriceAction(job('done', ago(HOUR)), role, NOW)).toBeNull();
  });
});

// @traces 1393-FR-011
describe('the job kinds the garage re-reads on', () => {
  it('holds the handover and the correction', () => {
    expect(JOB_KINDS).toEqual(
      expect.arrayContaining(['job.handed_over', 'job.final_price_corrected']),
    );
  });
});
