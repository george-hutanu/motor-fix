import type { PublicGarageDto } from '@motor-fix/data-access';

// The jobs on, in the list's order, and their range summed in bani and rounded
// once to whole lei: the box and the bar say the same numbers.
export function estimateTotals(
  prices: PublicGarageDto['prices'],
  on: ReadonlySet<string>,
) {
  const chosen = prices.filter((row) => on.has(row.jobTypeId));
  const sum = (key: 'fromBani' | 'toBani') =>
    Math.round(chosen.reduce((total, row) => total + row[key], 0) / 100);
  return { chosen, fromLei: sum('fromBani'), toLei: sum('toBani') };
}
