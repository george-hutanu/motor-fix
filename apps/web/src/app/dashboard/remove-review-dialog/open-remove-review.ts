import type { ReportQueueItemDto } from '@motor-fix/data-access';
import type { Overlays } from '@motor-fix/overlays';

import type {
  RemoveReviewData,
  RemoveReviewResult,
} from './remove-review-dialog';

// The removal task, loaded on the first press so it stays out of the initial
// bundle; titled with the author of a review or the garage of a reply.
// Resolves with the outcome or 'cancelled'.
export async function openRemoveReview(
  overlays: Overlays,
  item: ReportQueueItemDto,
) {
  const { RemoveReviewDialog } = await import('./remove-review-dialog');
  return overlays.open<RemoveReviewResult, RemoveReviewData>(
    RemoveReviewDialog,
    {
      data: { item },
      shape: 'dialog',
      title: item.reply
        ? 'admin.reviews.remove.title.reply'
        : 'admin.reviews.remove.title.review',
      titleParams: { name: item.reply ? item.garage.name : item.review.author },
    },
  );
}
