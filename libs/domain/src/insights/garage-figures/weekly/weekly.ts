import type { WeeklyFigureDto } from '@motor-fix/contracts';

import { addDays, isoWeek, localDay, weekStart } from '../../../bucharest';

// The garage's eight weekly figures, worked out from what the reads return:
// pure, so the week edges, the rounding and the approval are tested alone.

type Week = Pick<WeeklyFigureDto, 'from' | 'key' | 'to'>;

const WEEKS = 8;

// The eight complete ISO weeks before the one holding today, oldest first.
export function figureWeeks(today: string): Week[] {
  const last = addDays(weekStart(today), -7);
  return Array.from({ length: WEEKS }, (_, i) => {
    const from = addDays(last, -7 * (WEEKS - 1 - i));
    return { from, key: isoWeek(from), to: addDays(from, 6) };
  });
}

// Requests per hundred views, one decimal rounded half up, at most 100. The
// tenths are rounded as a whole number, so 6.25 is 6.3.
export function conversion(requests: number, views: number): number | null {
  if (views === 0) return null;
  return Math.min(1000, Math.round((requests * 1000) / views)) / 10;
}

// Each week's views (buckets keyed by ISO week, summed) and requests on the
// Bucharest clock. A week before the week of the approval day is null; a
// garage never approved has no numbers.
export function weeklyFigures(input: {
  approvedAt: Date | null;
  requests: Date[];
  today: string;
  views: { key: string; views: number }[];
}): WeeklyFigureDto[] {
  const approvalWeek = input.approvedAt
    ? weekStart(localDay(input.approvedAt))
    : null;
  const views = new Map<string, number>();
  for (const bucket of input.views)
    views.set(bucket.key, (views.get(bucket.key) ?? 0) + bucket.views);
  const requests = new Map<string, number>();
  for (const at of input.requests) {
    const week = weekStart(localDay(at));
    requests.set(week, (requests.get(week) ?? 0) + 1);
  }
  return figureWeeks(input.today).map((week) => {
    if (approvalWeek === null || week.from < approvalWeek)
      return { ...week, conversion: null, requests: null, views: null };
    const seen = views.get(week.key) ?? 0;
    const reached = requests.get(week.from) ?? 0;
    return {
      ...week,
      conversion: conversion(reached, seen),
      requests: reached,
      views: seen,
    };
  });
}
