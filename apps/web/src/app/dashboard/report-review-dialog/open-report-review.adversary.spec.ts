import type { Overlays } from '@motor-fix/overlays';

import { openReportReview } from './open-report-review';
import { staffReview } from '../garage-reviews/garage-reviews.testing';

// @traces 1382-FR-008 1382-FR-003
describe('opening the report task', () => {
  it('asks for a dialog titled by the report key and carries the review as data', async () => {
    const open = jest.fn(async () => 'cancelled');
    const review = staffReview({ id: 'r-77' });

    await openReportReview({ open } as unknown as Overlays, review);

    expect(open).toHaveBeenCalledTimes(1);
    const [component, config] = open.mock.calls[0] as unknown as [
      { name: string },
      Record<string, unknown>,
    ];
    expect(component.name).toBe('ReportReviewDialog');
    expect(config).toEqual({
      data: { review },
      shape: 'dialog',
      title: 'garage.reviews.report.title',
    });
  });

  it('hands back exactly what the overlay resolves', async () => {
    const open = jest.fn(async () => 'refused');

    await expect(
      openReportReview({ open } as unknown as Overlays, staffReview()),
    ).resolves.toBe('refused');
  });

  it('rejects when the overlay itself fails, rather than resolving a result', async () => {
    const open = jest.fn(async () => {
      throw new Error('boom');
    });

    await expect(
      openReportReview({ open } as unknown as Overlays, staffReview()),
    ).rejects.toThrow('boom');
  });
});
