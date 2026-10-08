// A garage's opening hours, closed days and facilities: the listing form, the
// draft save and the write at submit read the section by these same rules.
// Browser-safe: no Nest or validator import.

export const WEEKDAYS = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

// Europe/Bucharest wall-clock times, "HH:MM".
export type Interval = [string, string];
export type WeeklyHours = Record<Weekday, Interval[]>;

export interface ClosedDay {
  day: string;
  note?: string;
}

export const FACILITIES = [
  'courtesy_car',
  'pickup_dropoff',
  'waiting_area',
] as const;
export type Facility = (typeof FACILITIES)[number];

export const PAYMENTS = ['cash', 'card', 'transfer'] as const;
export type Payment = (typeof PAYMENTS)[number];

// The price a day in bani, whole lei only.
export const COURTESY_PRICE_MIN_BANI = 100;
export const COURTESY_PRICE_MAX_BANI = 200_000;
export const COURTESY_PRICE_STEP_BANI = 100;

export interface CourtesyCar {
  paid: boolean;
  pricePerDayBani?: number;
}

export interface HoursSection {
  hours?: WeeklyHours;
  closedDays?: ClosedDay[];
  facilities?: Facility[];
  payments?: Payment[];
  courtesyCar?: CourtesyCar;
}

export const CLOSED_NOTE_MAX = 80;
export const CLOSED_DAY_YEARS = 2;
const INTERVALS_MAX = 2;

export const TIMES: readonly string[] = Array.from({ length: 96 }, (_, i) => {
  const hours = String(Math.floor(i / 4)).padStart(2, '0');
  return `${hours}:${String((i % 4) * 15).padStart(2, '0')}`;
});

const OPEN_DAY: Interval[] = [['08:00', '17:00']];
export const DEFAULT_HOURS: WeeklyHours = {
  fri: OPEN_DAY,
  mon: OPEN_DAY,
  sat: [],
  sun: [],
  thu: OPEN_DAY,
  tue: OPEN_DAY,
  wed: OPEN_DAY,
};

const TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const letters = (text: string) => [...text].length;

export const isTime = (value: unknown): value is string =>
  typeof value === 'string' && TIME.test(value);

const isInterval = (value: unknown): value is Interval =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((time) => typeof time === 'string');

type IntervalsError = 'count' | 'grid' | 'order' | 'overlap';

// "HH:MM" strings compare in time order.
export function intervalsError(list: Interval[]): IntervalsError | null {
  if (list.length > INTERVALS_MAX) return 'count';
  if (!list.every(([open, close]) => isTime(open) && isTime(close)))
    return 'grid';
  if (list.some(([open, close]) => close <= open)) return 'order';
  for (let i = 1; i < list.length; i++)
    if (list[i][0] < list[i - 1][1]) return 'overlap';
  return null;
}

export function isWeeklyHours(value: unknown): value is WeeklyHours {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === WEEKDAYS.length &&
    WEEKDAYS.every((day) => {
      const list = value[day];
      return (
        Array.isArray(list) &&
        list.every(isInterval) &&
        intervalsError(list) === null
      );
    })
  );
}

const isDay = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const match = DAY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.toISOString().slice(0, 10) === value;
};

function isClosedDay(value: unknown): value is ClosedDay {
  if (!isRecord(value)) return false;
  const { day, note, ...rest } = value;
  return (
    Object.keys(rest).length === 0 &&
    isDay(day) &&
    (note === undefined ||
      (typeof note === 'string' && letters(note.trim()) <= CLOSED_NOTE_MAX))
  );
}

export function closedDaysError(list: unknown): 'shape' | 'duplicate' | null {
  if (!Array.isArray(list) || !list.every(isClosedDay)) return 'shape';
  const days = new Set(list.map((entry) => entry.day));
  return days.size === list.length ? null : 'duplicate';
}

// The same calendar day two years on; 29 February falls back to the 28th.
function yearsAfter(day: string, years: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const later = new Date(Date.UTC(year + years, month - 1, date));
  if (later.getUTCMonth() !== month - 1) later.setUTCDate(0);
  return later.toISOString().slice(0, 10);
}

// The last day a closed day may fall on, counted from `today`.
export const lastClosedDay = (today: string) =>
  yearsAfter(today, CLOSED_DAY_YEARS);

export type ClosedDayError = 'past' | 'tooFar' | 'duplicate' | 'holiday';

// Whether the owner may add this day; `holidays` is empty when the calendar
// could not be read, and the write drops a holiday anyway.
export function closedDayError(
  day: string,
  list: ClosedDay[],
  today: string,
  holidays: readonly string[],
): ClosedDayError | null {
  if (day < today) return 'past';
  if (day > lastClosedDay(today)) return 'tooFar';
  if (list.some((entry) => entry.day === day)) return 'duplicate';
  if (holidays.includes(day)) return 'holiday';
  return null;
}

const isSetOf =
  <T>(values: readonly T[]) =>
  (value: unknown): value is T[] =>
    Array.isArray(value) &&
    value.every((item) => values.includes(item)) &&
    new Set(value).size === value.length;

const isFacilities = isSetOf(FACILITIES);
const isPayments = isSetOf(PAYMENTS);

export const isCourtesyPrice = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= COURTESY_PRICE_MIN_BANI &&
  (value as number) <= COURTESY_PRICE_MAX_BANI &&
  (value as number) % COURTESY_PRICE_STEP_BANI === 0;

// Paid with the price still to type is kept; a typed price must be valid.
function isCourtesyCar(value: unknown): value is CourtesyCar {
  if (!isRecord(value)) return false;
  const { paid, pricePerDayBani, ...rest } = value;
  return (
    Object.keys(rest).length === 0 &&
    typeof paid === 'boolean' &&
    (pricePerDayBani === undefined || isCourtesyPrice(pricePerDayBani))
  );
}

// The step 5 section as the draft keeps it. Other stories' keys share the
// section and pass untouched.
export function isHoursSection(
  value: unknown,
): value is Record<string, unknown> & HoursSection {
  if (!isRecord(value)) return false;
  const { closedDays, courtesyCar, facilities, hours, payments } = value;
  return (
    (hours === undefined || isWeeklyHours(hours)) &&
    (closedDays === undefined || closedDaysError(closedDays) === null) &&
    (facilities === undefined || isFacilities(facilities)) &&
    (payments === undefined || isPayments(payments)) &&
    (courtesyCar === undefined || isCourtesyCar(courtesyCar))
  );
}

// Ready to tick: at least one payment, and a price when a listed courtesy car
// is paid.
export function hoursComplete(section: HoursSection): boolean {
  const car = section.courtesyCar;
  const needsPrice =
    (section.facilities ?? []).includes('courtesy_car') && car?.paid === true;
  return (
    (section.payments ?? []).length > 0 &&
    (!needsPrice || isCourtesyPrice(car?.pricePerDayBani))
  );
}

const BUCHAREST_DAY = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Europe/Bucharest',
  year: 'numeric',
});

export const todayInBucharest = (at: Date = new Date()): string =>
  BUCHAREST_DAY.format(at);
