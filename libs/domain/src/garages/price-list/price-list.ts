import type { PriceListItemDto, PriceListReason } from '@motor-fix/contracts';

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
    jobType.rarActivity !== null &&
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
    byJob.set(row.jobType.id, [...(byJob.get(row.jobType.id) ?? []), row]);
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
