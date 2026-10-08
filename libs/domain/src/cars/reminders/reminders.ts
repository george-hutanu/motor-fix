import { daysBetween } from '../../bucharest';
import type { ReminderKind } from '../../generated/prisma/client';

export interface ReminderState {
  kind: ReminderKind;
  // "2026-12-10"; null for tyres.
  dueOn: string | null;
  sent30: boolean;
  sent7: boolean;
  seasonYear: number | null;
  sentAt: Date | null;
}

export type ReminderStage = '30' | '7' | 'season' | 'day_before';

const TYPE: Record<ReminderKind, string> = {
  booking: 'BOOKING_REMINDER',
  itp: 'DUE_ITP',
  rca: 'DUE_RCA',
  rovinieta: 'DUE_ROVINIETA',
  service: 'SERVICE_DUE',
  tyres_summer: 'TYRES_SEASON',
  tyres_winter: 'TYRES_SEASON',
};

// The tyre season whose reminder goes in the month of `day`: winter from
// 1 November, summer from 1 April.
export function seasonOf(day: string): ReminderKind | null {
  const month = Number(day.slice(5, 7));
  if (month === 11) return 'tyres_winter';
  return month === 4 ? 'tyres_summer' : null;
}

const tyres = (r: ReminderState, today: string): ReminderStage | null =>
  seasonOf(today) === r.kind && r.seasonYear !== Number(today.slice(0, 4))
    ? 'season'
    : null;

const booking = (r: ReminderState, left: number): ReminderStage | null =>
  left === 1 && r.sentAt === null ? 'day_before' : null;

function dueDate(r: ReminderState, left: number): ReminderStage | null {
  if (left < 0 || left > 30) return null;
  if (left <= 7) return r.sent7 ? null : '7';
  return r.sent30 ? null : '30';
}

function stage(r: ReminderState, today: string): ReminderStage | null {
  if (r.kind === 'tyres_winter' || r.kind === 'tyres_summer') {
    return tyres(r, today);
  }
  if (r.dueOn === null) return null;
  const left = daysBetween(today, r.dueOn);
  return r.kind === 'booking' ? booking(r, left) : dueDate(r, left);
}

// What the run of `today` sends for a reminder, if anything.
export function dueStage(r: ReminderState, today: string) {
  const s = stage(r, today);
  return s === null ? null : { stage: s, type: TYPE[r.kind] };
}
