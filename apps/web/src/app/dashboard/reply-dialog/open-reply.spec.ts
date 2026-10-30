import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Overlays } from '@motor-fix/overlays';

import { openReply } from './open-reply';
import { ReplyDialog } from './reply-dialog';
import {
  repliedReview,
  staffReview,
} from '../garage-reviews/garage-reviews.testing';

// @traces 1387-FR-002 1387-FR-006
describe('opening the reply dialog', () => {
  const overlays = () => {
    const open = jest.fn().mockResolvedValue('cancelled');
    return { open, overlays: { open } as unknown as Overlays };
  };

  it('opens the dialog under the reply title, handing it the review and the callback', async () => {
    const { open, overlays: one } = overlays();
    const review = staffReview();
    const saved = jest.fn();

    await expect(openReply(one, review, saved)).resolves.toBe('cancelled');

    expect(open).toHaveBeenCalledWith(ReplyDialog, {
      data: { review, saved },
      shape: 'dialog',
      title: 'garage.reviews.reply.title',
    });
  });

  it('opens it under the edit title for a review already answered', async () => {
    const { open, overlays: one } = overlays();

    await openReply(one, repliedReview(), jest.fn());

    expect(open.mock.calls[0][1].title).toBe('garage.reviews.reply.titleEdit');
  });

  // The panel sits on the garage home: a value import of the dialog there or
  // in the opener would pull it into the dashboard's first chunk.
  it('reaches the dialog only through a dynamic import', () => {
    const source = (file: string) =>
      readFileSync(join(__dirname, file), 'utf8');
    const opener = source('open-reply.ts');
    const panel = source(
      '../garage-reviews/garage-reviews-panel/garage-reviews-panel.ts',
    );
    const valueImport = /^import\s+(?!type\b)[^;]*from\s+'[^']*reply-dialog'/m;

    expect(opener).toContain("await import('./reply-dialog')");
    expect(opener).not.toMatch(valueImport);
    expect(panel).not.toMatch(valueImport);
    expect(panel).not.toMatch(/reply-dialog\/reply-dialog'/);
  });
});
