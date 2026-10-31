import type {
  GarageStaffReviewDto,
  ReviewReplyDto,
} from '@motor-fix/data-access';
import type { Overlays } from '@motor-fix/overlays';

export interface ReplyData {
  review: GarageStaffReviewDto;
  // Called with the API's answer as soon as the save succeeds, so the row
  // updates even when the confirmation is dismissed rather than closed.
  saved: (reply: ReviewReplyDto) => void;
}

// The reply dialog, loaded on the first press so it stays out of the initial
// bundle. A review already answered opens as the edit of its reply.
export async function openReply(
  overlays: Overlays,
  review: GarageStaffReviewDto,
  saved: (reply: ReviewReplyDto) => void,
) {
  const { ReplyDialog } = await import('./reply-dialog');
  return overlays.open<ReviewReplyDto, ReplyData>(ReplyDialog, {
    data: { review, saved },
    shape: 'dialog',
    title: review.reply
      ? 'garage.reviews.reply.titleEdit'
      : 'garage.reviews.reply.title',
  });
}
