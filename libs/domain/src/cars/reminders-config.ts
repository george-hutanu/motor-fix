import type { AppEnv } from '@motor-fix/contracts';

// REMINDER_DAY_MS shortens a reminder day so the 30-day and 7-day reminders
// can be watched end to end; it never reaches real drivers.
export function reminderDayMs(
  appEnv: AppEnv,
  env: Record<string, string | undefined>,
): number | undefined {
  const value = env['REMINDER_DAY_MS'];
  if (value === undefined) return undefined;
  if (appEnv === 'staging' || appEnv === 'production') {
    throw new Error(`REMINDER_DAY_MS must not be set in ${appEnv}`);
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('REMINDER_DAY_MS must be a positive whole number');
  }
  return Number(value);
}
