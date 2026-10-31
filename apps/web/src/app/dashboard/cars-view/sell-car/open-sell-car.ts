import type { CarDto } from '@motor-fix/data-access';
import type { Overlays } from '@motor-fix/overlays';

import type { SellCarData, SellCarResult } from './sell-car';

// The sale dialog, fetched on the first tap.
export async function openSellCar(overlays: Overlays, car: CarDto) {
  const { SellCar } = await import('./sell-car');
  return overlays.open<SellCarResult, SellCarData>(SellCar, {
    data: { car },
    shape: 'dialog',
    title: 'driver.cars.sale.title',
    titleParams: { car: `${car.brandName} ${car.model}` },
  });
}
