import { addDays, addMonths, daysBetween } from '../../bucharest';

// One odometer reading: the kilometres seen on `readOn`, a Bucharest day.
export interface Reading {
  km: number;
  readOn: string;
  createdAt: Date;
}

const DAYS_A_MONTH = 30.44;
const DEFAULT_MONTHLY_KM = 1000;
const MIN_SPAN_DAYS = 30;
// An estimate past ten years is shown as ten years: the date stays a real day.
const HORIZON_DAYS = 3650;

const order = (a: Reading, b: Reading) =>
  a.readOn.localeCompare(b.readOn) ||
  a.createdAt.getTime() - b.createdAt.getTime();

// The readings of the last 12 months, oldest first.
function recent(readings: Reading[], today: string): Reading[] {
  const from = addMonths(today, -12);
  return readings.filter((r) => r.readOn >= from).sort(order);
}

// Kilometres a month from the oldest and newest reading of the last 12
// months; 1,000 when they are under 30 days apart or the odometer did not rise.
export function monthlyAverageKm(readings: Reading[], today: string): number {
  const window = recent(readings, today);
  const oldest = window[0];
  const newest = window[window.length - 1];
  if (!oldest || !newest) return DEFAULT_MONTHLY_KM;
  const days = daysBetween(oldest.readOn, newest.readOn);
  const km = newest.km - oldest.km;
  if (days < MIN_SPAN_DAYS || km <= 0) return DEFAULT_MONTHLY_KM;
  return (km / days) * DAYS_A_MONTH;
}

// The day the car reaches its next oil service at its average mileage,
// counted from the newest reading; null without a value or once it is reached.
export function serviceDueOn(
  car: { odometerKm: number; nextServiceKm: number | null },
  readings: Reading[],
  today: string,
): string | null {
  if (car.nextServiceKm === null) return null;
  const left = car.nextServiceKm - car.odometerKm;
  if (left <= 0) return null;
  const perDay = monthlyAverageKm(readings, today) / DAYS_A_MONTH;
  const newest = [...readings].sort(order).at(-1)?.readOn ?? today;
  return addDays(newest, Math.min(Math.round(left / perDay), HORIZON_DAYS));
}
