import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Overlays } from '@motor-fix/overlays';

import { BlockTimeDialog } from './block-time-dialog';
import { openBlockTime } from './open-block-time';

// @traces 1403-FR-010
describe('opening the block-time dialog', () => {
  const overlays = () => {
    const open = jest.fn().mockResolvedValue('blocked');
    return { open, overlays: { open } as unknown as Overlays };
  };

  it('opens the dialog under the new-block title and hands back its answer', async () => {
    const { open, overlays: one } = overlays();
    const data = { garageId: 'g-1', lifts: true, team: false };

    await expect(openBlockTime(one, data)).resolves.toBe('blocked');

    expect(open).toHaveBeenCalledWith(BlockTimeDialog, {
      data,
      shape: 'dialog',
      title: 'garage.timeBlocks.title',
    });
  });

  it('opens it under the change title for a block that exists', async () => {
    const { open, overlays: one } = overlays();
    const block = {
      endsAt: '2026-11-02T11:00:00+02:00',
      id: 'b-1',
      mechanic: null,
      note: null,
      segments: [],
      startsAt: '2026-11-02T10:00:00+02:00',
    };

    await openBlockTime(one, {
      block: block as never,
      garageId: 'g-1',
      lifts: true,
      team: true,
    });

    expect(open.mock.calls[0][1].title).toBe('garage.timeBlocks.titleEdit');
  });

  // The dashboard is in the initial bundle's reach only through this file:
  // a value import of the dialog here or there would pull it in.
  it('reaches the dialog only through a dynamic import', () => {
    const source = (file: string) =>
      readFileSync(join(__dirname, file), 'utf8');
    const opener = source('open-block-time.ts');
    const home = source('../garage-requests/garage-home/garage-home.ts');
    const valueImport =
      /^import\s+(?!type\b)[^;]*from\s+'[^']*block-time-dialog'/m;

    expect(opener).toContain("await import('./block-time-dialog')");
    expect(opener).not.toMatch(valueImport);
    expect(home).not.toMatch(valueImport);
    expect(home).not.toMatch(/block-time-dialog\/block-time-dialog'/);
  });
});
