import type { GarageStaffReviewDto } from '@motor-fix/data-access';
import type { Overlays } from '@motor-fix/overlays';

import type {
  ReportReviewData,
  ReportReviewResult,
} from './report-review-dialog';

// The report task, loaded on the first press so it stays out of the initial
// bundle. Resolves with the answer, 'refused' or 'cancelled'.
export async function openReportReview(
  overlays: Overlays,
  review: GarageStaffReviewDto,
) {
  const { ReportReviewDialog } = await import('./report-review-dialog');
  return overlays.open<ReportReviewResult, ReportReviewData>(
    ReportReviewDialog,
    {
      data: { review },
      shape: 'dialog',
      title: 'garage.reviews.report.title',
    },
  );
}
