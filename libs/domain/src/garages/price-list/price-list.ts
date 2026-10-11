import type {
  PriceListItemDto,
  PriceListReason,
  PublicPriceRowDto,
} from '@motor-fix/contracts';

import type { JobTypeStatus } from '../../generated/prisma/client';

// One stored price row with its catalogue job: no brand is the default range.
export interface PriceRow {
  id: string;
  brandId: string | null;
  visible: boolean;
  fromBani: number;
  toBani: number | null;
  durationMinutes: number | null;
  position: number;
  jobType: {
    id: string;
    nameRo: string;
    nameEn: string;
    status: JobTypeStatus;
    rarActivity: string | null;
  };
}

// What the price list rule reads of each stored row; the public profile
// reads the same.
export const PRICE_ROW_SELECT = {
  brandId: true,
  durationMinutes: true,
  fromBani: true,
  id: true,
  jobType: {
    select: {
      id: true,
      nameEn: true,
      nameRo: true,
      rarActivity: true,
      status: true,
    },
  },
  position: true,
  toBani: true,
  visible: true,
} as const;

// The first reason that applies, in the order PRICE_LIST_REASONS lists them;
// none when drivers see the job. The default range decides for every brand,
// and a garage with no RAR activity recorded yet covers every job.
function reasonOf(
  { jobType }: PriceRow,
  defaultRow: PriceRow | undefined,
  rarActivities: readonly string[],
): PriceListReason | undefined {
  if (jobType.status === 'rejected') return 'rejected';
  if (jobType.status === 'pending') return 'awaiting_approval';
  if (
    rarActivities.length > 0 &&
    jobType.rarActivity &&
    !rarActivities.includes(jobType.rarActivity)
  ) {
    return 'not_authorised';
  }
  if (defaultRow && !defaultRow.visible) return 'hidden_by_garage';
  if (defaultRow?.toBani == null) return 'no_top_price';
  return undefined;
}

// A job's place in the list: its default row's, else its first brand row's.
const before = (a: PriceRow, b: PriceRow) =>
  a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Every job of a garage's price list once, in the list's order, with whether
// drivers see it and, when not, why. Computed on each read, never stored.
export function priceListJobs(
  rows: readonly PriceRow[],
  rarActivities: readonly string[],
): PriceListItemDto[] {
  const byJob = new Map<string, PriceRow[]>();
  for (const row of rows) {
    const jobRows = byJob.get(row.jobType.id);
    if (jobRows) jobRows.push(row);
    else byJob.set(row.jobType.id, [row]);
  }
  return [...byJob.values()]
    .map((jobRows) => {
      const defaultRow = jobRows.find((row) => row.brandId === null);
      return {
        defaultRow,
        place: defaultRow ?? [...jobRows].sort(before)[0],
      };
    })
    .sort((a, b) => before(a.place, b.place))
    .map(({ defaultRow, place }) => {
      const { id, nameEn, nameRo } = place.jobType;
      const reason = reasonOf(place, defaultRow, rarActivities);
      return {
        jobTypeId: id,
        nameEn,
        nameRo,
        public: reason === undefined,
        ...(reason && { reason }),
        ...(defaultRow?.durationMinutes != null && {
          durationMinutes: defaultRow.durationMinutes,
        }),
        ...(defaultRow && { fromBani: defaultRow.fromBani }),
        ...(defaultRow?.toBani != null && { toBani: defaultRow.toBani }),
      };
    });
}

// A brand's own range for a job, only when it has both ends.
const brandRange = (
  rows: readonly PriceRow[],
  jobTypeId: string,
  brandId: string | undefined,
) => {
  if (brandId === undefined) return undefined;
  return rows.find(
    (row) =>
      row.jobType.id === jobTypeId &&
      row.brandId === brandId &&
      row.toBani != null,
  );
};

// The jobs drivers see on a profile, in the list's order. With a brand in
// context its complete range replaces the default and, once the garage ticked
// any job for it, only the ticked jobs are listed; visibility, order and
// duration always come from the default row. A caller that already holds
// priceListJobs' answer passes it as jobs.
export function publicPriceRows(
  rows: readonly PriceRow[],
  rarActivities: readonly string[],
  brand?: { id: string; ticks: readonly string[] },
  jobs: readonly PriceListItemDto[] = priceListJobs(rows, rarActivities),
): PublicPriceRowDto[] {
  const ticks = new Set(brand?.ticks);
  const listed = (jobTypeId: string) =>
    ticks.size === 0 || ticks.has(jobTypeId);
  return jobs.flatMap((item) => {
    const { durationMinutes, fromBani, jobTypeId, nameEn, nameRo, toBani } =
      item;
    if (!item.public || fromBani === undefined || toBani == null) return [];
    if (!listed(jobTypeId)) return [];
    const own = brandRange(rows, jobTypeId, brand?.id);
    return [
      {
        jobTypeId,
        nameEn,
        nameRo,
        ...(durationMinutes !== undefined && { durationMinutes }),
        fromBani: own?.fromBani ?? fromBani,
        toBani: own?.toBani ?? toBani,
      },
    ];
  });
}
