import type { TimeBlockDto } from '@motor-fix/data-access';
import type { Overlays } from '@motor-fix/overlays';

export interface BlockTimeData {
  garageId: string;
  // The garage's switches: Mecanic is drawn while the team is on, Elevator
  // while lifts are scheduled.
  team: boolean;
  lifts: boolean;
  // The block to change or remove; none for a new one.
  block?: TimeBlockDto;
}

// Refused: the block ended or was removed meanwhile; the opener re-reads.
export type BlockTimeResult = 'blocked' | 'changed' | 'removed' | 'refused';

// The block-time dialog, loaded on the first press so it stays out of the
// initial bundle. Resolves with what was done, or 'cancelled'.
export async function openBlockTime(overlays: Overlays, data: BlockTimeData) {
  const { BlockTimeDialog } = await import('./block-time-dialog');
  return overlays.open<BlockTimeResult, BlockTimeData>(BlockTimeDialog, {
    data,
    shape: 'dialog',
    title: data.block
      ? 'garage.timeBlocks.titleEdit'
      : 'garage.timeBlocks.title',
  });
}
