import type { Overlays } from '@motor-fix/overlays';

import { openReportReview } from './open-report-review';
import { ReportReviewDialog } from './report-review-dialog';
import { staffReview } from '../garage-reviews/garage-reviews.testing';

// @traces 1382-FR-003 1382-FR-008
describe('opening the report task', () => {
  it('opens the dialog shape with the review, titled Raportează recenzia', async () => {
    const open = jest.fn(async () => 'cancelled');
    const review = staffReview();

    const result = await openReportReview(
      { open } as unknown as Overlays,
      review,
    );

    expect(result).toBe('cancelled');
    expect(open).toHaveBeenCalledWith(ReportReviewDialog, {
      data: { review },
      shape: 'dialog',
      title: 'garage.reviews.report.title',
    });
  });
});
