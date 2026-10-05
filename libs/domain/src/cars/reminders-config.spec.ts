import { reminderDayMs } from './reminders-config';

describe('the shortened reminder day', () => {
  it('is off when it is not set', () => {
    expect(reminderDayMs('production', {})).toBeUndefined();
    expect(reminderDayMs('test', {})).toBeUndefined();
  });

  it('is read in a test or development environment', () => {
    expect(reminderDayMs('test', { REMINDER_DAY_MS: '2000' })).toBe(2000);
    expect(reminderDayMs('development', { REMINDER_DAY_MS: '60000' })).toBe(
      60000,
    );
  });

  it('refuses to start staging or production with it set', () => {
    expect(() =>
      reminderDayMs('production', { REMINDER_DAY_MS: '2000' }),
    ).toThrow(/REMINDER_DAY_MS/);
    expect(() => reminderDayMs('staging', { REMINDER_DAY_MS: '2000' })).toThrow(
      /REMINDER_DAY_MS/,
    );
  });

  it('refuses a value that is not a positive whole number', () => {
    for (const value of ['0', '-5', 'abc', '1.5', '']) {
      expect(() => reminderDayMs('test', { REMINDER_DAY_MS: value })).toThrow(
        /REMINDER_DAY_MS/,
      );
    }
  });
});
