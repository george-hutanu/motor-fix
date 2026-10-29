import { addDays, atLocal, localDay } from '../../bucharest';

// A block's range cut at each Bucharest midnight it crosses: one span per day
// it touches, a clock-change day 23 or 25 hours long.
export function segmentsOf(startsAt: Date, endsAt: Date): [Date, Date][] {
  const spans: [Date, Date][] = [];
  for (let from = startsAt; from < endsAt; ) {
    const midnight = atLocal(addDays(localDay(from), 1), 0);
    const to = midnight < endsAt ? midnight : endsAt;
    spans.push([from, to]);
    from = to;
  }
  return spans;
}
