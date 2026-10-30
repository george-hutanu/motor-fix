import { FINAL_PRICE_CORRECTION_HOURS } from '@motor-fix/contracts/request-status';
import type { JobDto } from '@motor-fix/data-access';

import { finalPriceAction, JOB_KINDS } from './jobs';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-30T10:00:00.000Z');
const at = (offset: number) => new Date(NOW.getTime() + offset).toISOString();
const WINDOW = FINAL_PRICE_CORRECTION_HOURS * HOUR;

const job = (
  status: JobDto['status'],
  handedOverAt: string | null = null,
): Pick<JobDto, 'status' | 'handedOverAt'> => ({ handedOverAt, status });

// @traces 1393-FR-001
// @traces 1393-FR-006
// @traces 1393-FR-008
describe('the final price action under hostile input', () => {
  it('offers the correction one millisecond before the window closes', () => {
    expect(finalPriceAction(job('done', at(-WINDOW + 1)), 'garage', NOW)).toBe(
      'correct',
    );
  });

  it('offers nothing one millisecond after the window closed', () => {
    expect(finalPriceAction(job('done', at(-WINDOW - 1)), 'garage', NOW)).toBe(
      null,
    );
  });

  it('still offers the correction when the handover is stamped ahead of the browser clock', () => {
    expect(
      finalPriceAction(job('done', at(5 * HOUR)), 'receptionist', NOW),
    ).toBe('correct');
  });

  it('offers nothing for an unparseable handover time', () => {
    expect(
      finalPriceAction(job('done', 'not a date'), 'garage', NOW),
    ).toBeNull();
  });

  it.each(['Garage', 'RECEPTIONIST', 'admin', 'driver', '', ' garage'])(
    'offers the role "%s" nothing',
    (role) => {
      expect(finalPriceAction(job('done'), role, NOW)).toBeNull();
    },
  );

  it.each(['to_do', 'in_work', 'paused', 'cancelled'] as const)(
    'offers no correction on a %s job that carries a handover time',
    (status) => {
      expect(
        finalPriceAction(job(status, at(-HOUR)), 'garage', NOW),
      ).toBeNull();
    },
  );

  it('gives the same answer when asked twice', () => {
    const j = job('done');
    expect(finalPriceAction(j, 'garage', NOW)).toBe(
      finalPriceAction(j, 'garage', NOW),
    );
  });
});

// @traces 1393-FR-011
describe('the job kinds list', () => {
  it('holds each kind once', () => {
    expect(new Set(JOB_KINDS).size).toBe(JOB_KINDS.length);
  });

  it.each([
    'job.step_done',
    'job.step_undone',
    'job.steps_changed',
    'job.started',
    'job.paused',
    'job.resumed',
    'job.done',
    'job.reopened',
    'job.mechanic_changed',
    'job.handed_over',
    'job.final_price_corrected',
  ])('keeps %s', (kind) => {
    expect(JOB_KINDS).toContain(kind);
  });

  it('holds nothing outside the job family', () => {
    expect(JOB_KINDS.filter((k) => !k.startsWith('job.'))).toEqual([]);
  });
});
