import type { CarDto } from '@motor-fix/data-access';
import type { Overlays } from '@motor-fix/overlays';

import type { RemoveCarData } from './remove-car';

// The removal confirmation, loaded on the first tap so it stays out of the
// initial bundle. Resolves with true once the car is removed, or 'cancelled'.
export async function openRemoveCar(overlays: Overlays, car: CarDto) {
  const { RemoveCar } = await import('./remove-car');
  return overlays.open<true, RemoveCarData>(RemoveCar, {
    data: { car },
    shape: 'dialog',
    title: 'driver.cars.menu.remove',
  });
}
