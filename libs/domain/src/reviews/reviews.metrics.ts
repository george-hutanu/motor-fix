import { metrics } from '@opentelemetry/api';

export const REVIEW_POSTED_OUTCOMES = [
  'published',
  'job_not_done',
  'email_not_confirmed',
  'review_exists',
] as const;
type ReviewPostedOutcome = (typeof REVIEW_POSTED_OUTCOMES)[number];

// Looked up on every count, never cached: an instrument kept from before the
// meter provider is registered would stay a no-op for the life of the process.
export const reviewsPosted = () =>
  metrics.getMeter('motorfix').createCounter('motorfix_reviews_posted_total', {
    description: 'Reviews drivers tried to publish, by outcome',
  });

export function recordReviewPosted(outcome: ReviewPostedOutcome) {
  reviewsPosted().add(1, { outcome });
}
