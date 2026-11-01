import type { DueItemDto, DueItemsDto } from '@motor-fix/contracts';

import { daysBetween } from '../../bucharest';
import { type Reading, serviceDueOn } from '../odometer/odometer';

// An active car as the due items read it; its days are Bucharest days.
export interface DueCar {
  id: string;
  name: string;
  itpUntil: string | null;
  odometerKm: number;
  nextServiceKm: number | null;
  readings: Reading[];
}

// The card lines' thresholds: red within a week, amber within 60 days.
const RED_DAYS = 7;
const AMBER_DAYS = 60;
const KIND_ORDER = ['itp', 'oil'];

function stateOf(daysLeft: number | null, passed: boolean) {
  if (passed) return 'red';
  if (daysLeft === null) return 'grey';
  if (daysLeft <= RED_DAYS) return 'red';
  return daysLeft <= AMBER_DAYS ? 'amber' : 'green';
}

function itpRow(car: DueCar, today: string): DueItemDto {
  const daysLeft = car.itpUntil ? daysBetween(today, car.itpUntil) : null;
  const passed = daysLeft !== null && daysLeft < 0;
  return {
    carId: car.id,
    carName: car.name,
    daysLeft,
    dueKm: null,
    dueOn: car.itpUntil,
    kind: 'itp',
    kmLeft: null,
    passed,
    state: stateOf(daysLeft, passed),
  };
}

function oilRow(car: DueCar, dueKm: number, today: string): DueItemDto {
  const kmLeft = dueKm - car.odometerKm;
  const dueOn = serviceDueOn(car, car.readings, today);
  const daysLeft = dueOn ? daysBetween(today, dueOn) : null;
  const passed = kmLeft <= 0;
  return {
    carId: car.id,
    carName: car.name,
    daysLeft,
    dueKm,
    dueOn,
    kind: 'oil',
    kmLeft,
    passed,
    state: stateOf(daysLeft, passed),
  };
}

// Passed days, then kilometres over, then dated, then undated.
function group(item: DueItemDto) {
  if (item.passed) return item.kind === 'oil' ? 1 : 0;
  return item.dueOn === null ? 3 : 2;
}

function byGroup(item: DueItemDto): number {
  if (group(item) === 0) return item.daysLeft ?? 0;
  if (group(item) === 1) return item.kmLeft ?? 0;
  return 0;
}

function compare(a: DueItemDto, b: DueItemDto) {
  return (
    group(a) - group(b) ||
    byGroup(a) - byGroup(b) ||
    (a.dueOn ?? '').localeCompare(b.dueOn ?? '') ||
    a.carName.localeCompare(b.carName) ||
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    a.carId.localeCompare(b.carId)
  );
}

export function dueItems(cars: DueCar[], today: string): DueItemsDto {
  const items = cars
    .flatMap((car) =>
      car.nextServiceKm === null
        ? [itpRow(car, today)]
        : [itpRow(car, today), oilRow(car, car.nextServiceKm, today)],
    )
    .sort(compare);
  return {
    carCount: cars.length,
    dueSoonCount: items.filter((i) => i.state === 'red' || i.state === 'amber')
      .length,
    items,
  };
}
