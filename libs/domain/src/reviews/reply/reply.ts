import { REVIEW_REPLY_TEXT_MAX, type ReplyRefusal } from '@motor-fix/contracts';

import type {
  ReviewReplyStatus,
  ReviewStatus,
} from '../../generated/prisma/enums';

// What is wrong with the reply's text, or null: 1 to the cap in characters
// (code points) after the trim, as the dialog counts them.
export function replyTextProblemOf(
  text: string,
): { code: 'length'; field: 'text' } | null {
  const length = [...text.trim()].length;
  return length === 0 || length > REVIEW_REPLY_TEXT_MAX
    ? { code: 'length', field: 'text' }
    : null;
}

// Why the owner may not post (or edit) the review's reply, or null when she
// may. Read from the rows alone, so the staff read's canReply and the
// operations answer alike; an edit of a review with no reply is not_found.
export function replyRefusalOf(
  review: { status: ReviewStatus },
  reply: { status: ReviewReplyStatus } | null,
  mode: 'post' | 'edit',
): ReplyRefusal | 'not_found' | null {
  if (review.status !== 'published') return 'review_not_public';
  if (mode === 'post') {
    if (reply?.status === 'removed') return 'reply_removed';
    return reply ? 'already_replied' : null;
  }
  if (!reply) return 'not_found';
  if (reply.status === 'reported') return 'reply_not_public';
  if (reply.status === 'removed') return 'reply_removed';
  return null;
}

interface ReplyRow {
  id: string;
  text: string;
  postedAt: Date;
  editedAt: Date | null;
  status: ReviewReplyStatus;
}

// The reply as the garage's staff read it: published or reported; a removed
// one is gone for them too.
export const replyShapeOf = (reply: ReplyRow) => ({
  editedAt: reply.editedAt?.toISOString() ?? null,
  id: reply.id,
  postedAt: reply.postedAt.toISOString(),
  status: reply.status,
  text: reply.text,
});

export const staffReplyOf = (reply: ReplyRow | null) =>
  reply && reply.status !== 'removed' ? replyShapeOf(reply) : null;

// The reply as the public reads it: published only, and nothing of who
// posted it.
export const publicReplyOf = (reply: ReplyRow | null) =>
  reply?.status === 'published'
    ? {
        editedAt: reply.editedAt?.toISOString() ?? null,
        postedAt: reply.postedAt.toISOString(),
        text: reply.text,
      }
    : null;
