import type { CarDto } from '@motor-fix/data-access';
import { daysUntil } from '@motor-fix/i18n';
import type { LampState } from '@motor-fix/ui-cockpit';

export interface DueDateStatus {
  state: LampState;
  days: number | null;
  passed: boolean;
}

type LineKind = 'itp' | 'rca' | 'rovinieta' | 'oil';

interface CarLine {
  kind: LineKind;
  state: LampState;
  days: number | null;
  expiry: string | null;
}

// Until the car's own readings exist, it is taken to run 1,000 km a month.
const KM_PER_DAY = 1000 / 30.44;

const STATE_ORDER: Record<LampState, number> = {
  amber: 1,
  green: 2,
  grey: 3,
  red: 0,
};
// A date line comes before the oil line when both are as urgent.
const KIND_ORDER: Record<LineKind, number> = {
  itp: 0,
  oil: 3,
  rca: 1,
  rovinieta: 2,
};

function lampFor(days: number): LampState {
  if (days <= 7) return 'red';
  if (days <= 60) return 'amber';
  return 'green';
}

export function dueDateStatus(expiry: string | null, now: Date): DueDateStatus {
  const days = daysUntil(expiry, now);
  if (days === null) return { days, passed: false, state: 'grey' };
  return { days, passed: days < 0, state: lampFor(days) };
}

export function oilStatus(nextServiceKm: number, odometerKm: number) {
  const kmLeft = nextServiceKm - odometerKm;
  // `|| 0` turns the -0 a few km overdue rounds to into 0.
  const days = Math.round(kmLeft / KM_PER_DAY) || 0;
  return { days, kmLeft, state: lampFor(days) };
}

function compareLines(a: CarLine, b: CarLine): number {
  return (
    STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
    (a.days ?? 0) - (b.days ?? 0) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  );
}

type Dated = Pick<
  CarDto,
  'itpUntil' | 'rcaUntil' | 'rovinietaUntil' | 'nextServiceKm' | 'odometerKm'
>;

// The car's lines, most urgent first.
export function carLines(car: Dated, now: Date): CarLine[] {
  const dates: [LineKind, string | null][] = [
    ['itp', car.itpUntil],
    ['rca', car.rcaUntil],
    ['rovinieta', car.rovinietaUntil],
  ];
  const lines: CarLine[] = dates.map(([kind, expiry]) => {
    const { days, state } = dueDateStatus(expiry, now);
    return { days, expiry, kind, state };
  });
  // An answer cached before the field existed has no nextServiceKm at all.
  if (car.nextServiceKm != null) {
    const { days, state } = oilStatus(car.nextServiceKm, car.odometerKm);
    lines.push({ days, expiry: null, kind: 'oil', state });
  }
  return lines.sort(compareLines);
}

// Zero when both cars' first lines are as urgent, so a stable sort keeps the
// list's newest-first order between them.
export function compareCars(a: Dated, b: Dated, now: Date): number {
  return compareLines(carLines(a, now)[0], carLines(b, now)[0]);
}
