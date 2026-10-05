import { addDays, atLocal, local, localDay } from '../bucharest';

const QUIET_FROM = 22;
const QUIET_UNTIL = 8;

export function isQuiet(at: Date): boolean {
  const { hour } = local(at);
  return hour >= QUIET_FROM || hour < QUIET_UNTIL;
}

export function nextMorning(at: Date): Date {
  const today = localDay(at);
  const day = local(at).hour >= QUIET_UNTIL ? addDays(today, 1) : today;
  return atLocal(day, QUIET_UNTIL);
}
