import type { CarDto } from '@motor-fix/data-access';
import type { Overlays } from '@motor-fix/overlays';

import type { CarTaskData } from './add-car';

// The add-car dialog, loaded on the first tap so it stays out of the initial
// bundle; given a car, the same dialog edits it. Resolves with the saved car,
// or 'cancelled'.
export async function openAddCar(
  overlays: Overlays,
  plates: string[],
  edit?: Omit<CarTaskData, 'plates'>,
) {
  const { AddCar } = await import('./add-car');
  return overlays.open<CarDto, CarTaskData>(AddCar, {
    data: { plates, ...edit },
    shape: 'dialog',
    title: edit?.car ? 'driver.cars.edit.title' : 'driver.cars.add.title',
  });
}
