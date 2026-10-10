import type { CarDto } from '@motor-fix/data-access';
import type { Overlays } from '@motor-fix/overlays';

// The add-car dialog, loaded on the first tap so it stays out of the initial
// bundle. Resolves with the saved car, or 'cancelled'.
export async function openAddCar(overlays: Overlays, plates: string[]) {
  const { AddCar } = await import('./add-car');
  return overlays.open<CarDto, { plates: string[] }>(AddCar, {
    data: { plates },
    shape: 'dialog',
    title: 'driver.cars.add.title',
  });
}
