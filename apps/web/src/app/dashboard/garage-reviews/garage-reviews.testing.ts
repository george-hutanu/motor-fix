import type {
  GarageStaffReviewDto,
  GarageStaffReviewsPageDto,
  ReviewReplyDto,
} from '@motor-fix/data-access';

// The moment every review spec reads as "now".
export const NOW = new Date('2026-10-25T12:00:00.000Z');

export const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 3_600_000).toISOString();

// Andrei's five stars for the BMW's timing chain, Costel on the job.
export const staffReview = (
  over: Partial<GarageStaffReviewDto> = {},
): GarageStaffReviewDto => ({
  author: { shortName: 'Andrei M.' },
  canReply: true,
  canReport: true,
  car: {
    brand: 'BMW',
    engine: null,
    fuel: 'diesel',
    model: '320d',
    year: 2019,
  },
  editedAt: null,
  finalPriceBani: 180_000,
  id: 'r-1',
  jobs: [
    {
      id: 'j-1',
      jobTypeId: 't-1',
      nameEn: 'Timing chain kit',
      nameRo: 'Kit lanț distribuție',
      position: 0,
    },
  ],
  mechanic: { shortName: 'Costel R.' },
  paidBani: null,
  postedAt: hoursAgo(2),
  quote: { fromBani: 150_000, toBani: 200_000 },
  rating: 5,
  reply: null,
  reportRefusal: null,
  source: 'job',
  status: 'published',
  text: 'Lucrare curată, predată la timp.',
  ...over,
});

// The garage's answer to Andrei, on two lines, posted an hour ago.
export const staffReply = (
  over: Partial<ReviewReplyDto> = {},
): ReviewReplyDto => ({
  editedAt: null,
  id: 'rep-1',
  postedAt: hoursAgo(1),
  status: 'published',
  text: 'Mulțumim, Andrei!\nTe mai așteptăm.',
  ...over,
});

// A review the garage already answered: the API offers no second reply.
export const repliedReview = (
  over: Partial<GarageStaffReviewDto> = {},
  reply: Partial<ReviewReplyDto> = {},
): GarageStaffReviewDto =>
  staffReview({ canReply: false, reply: staffReply(reply), ...over });

export const staffPage = (
  over: Partial<GarageStaffReviewsPageDto> = {},
): GarageStaffReviewsPageDto => ({
  breakdown: { five: 180, four: 22, one: 2, three: 6, two: 2 },
  items: [staffReview()],
  page: 1,
  pageSize: 20,
  rating: 4.9,
  reviewCount: 212,
  slug: 'service-auto-militari',
  total: 212,
  ...over,
});
