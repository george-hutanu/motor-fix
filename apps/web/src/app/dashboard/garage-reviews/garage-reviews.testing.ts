import type {
  GarageStaffReviewDto,
  GarageStaffReviewsPageDto,
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
  postedAt: hoursAgo(2),
  rating: 5,
  source: 'job',
  status: 'published',
  text: 'Lucrare curată, predată la timp.',
  ...over,
});

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
