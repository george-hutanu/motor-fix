import type { CarDto } from '@motor-fix/data-access';
import type { Overlays } from '@motor-fix/overlays';

import type { CancelTransferData } from './cancel-transfer';

// The cancel confirmation, fetched on the first tap.
export async function openCancelTransfer(overlays: Overlays, car: CarDto) {
  const { CancelTransfer } = await import('./cancel-transfer');
  return overlays.open<true, CancelTransferData>(CancelTransfer, {
    data: { car },
    shape: 'dialog',
    title: 'driver.cars.transfer.confirm.title',
  });
}
