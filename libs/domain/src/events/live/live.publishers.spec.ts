import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { publicKinds } from './live.hub';

// @traces 154-FR-016

// Public kinds no write records yet, each with the open story that will.
// An entry leaves once its kind has a publisher; none is added.
const UNBUILT: Record<string, string> = {
  'facility.re_add_decided': 'admins decide on facility removals',
  'facility.removed': 'admins decide on facility removals',
  'review.appeal_decided': 'garages appeal a review, admins decide',
  'review.decided': 'admins moderate reported reviews',
  'review.deleted': 'drivers edit or delete their review',
  'review.edited': 'drivers edit or delete their review',
};

const SRC = join(__dirname, '..', '..');
const SKIPPED = /(\.spec\.ts|\.testing\.ts|\/live\.hub\.ts|\/audience\.ts)$/;

const sources = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => join(entry.parentPath, entry.name))
  .filter((path) => !SKIPPED.test(path))
  .map((path) => readFileSync(path, 'utf8'));

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A kind recorded through an argument names itself on a comment line.
const published = (kind: string) => {
  const literal = `kind: '${kind}'`;
  const comment = new RegExp(
    `^\\s*// publishes ${escapeRegExp(kind)}\\s*$`,
    'm',
  );
  return sources.some((text) => text.includes(literal) || comment.test(text));
};

const allowed = [...publicKinds()];

describe('the public kinds the live hub allows', () => {
  it('lists the kinds the public keys allow', () => {
    expect(allowed).toEqual(
      expect.arrayContaining([
        'garage.suspended',
        'garage.restored',
        'garage.slots_changed',
        'review.posted',
      ]),
    );
  });

  it('each have a publisher or an open story that will feed them', () => {
    const unfed = allowed.filter(
      (kind) => !published(kind) && !(kind in UNBUILT),
    );

    expect(unfed).toEqual([]);
  });

  it('drop a kind from the unbuilt list once it has a publisher', () => {
    const fed = Object.keys(UNBUILT).filter(published);

    expect(fed).toEqual([]);
  });

  it('keep no unbuilt entry for a kind the hub no longer allows', () => {
    const stale = Object.keys(UNBUILT).filter(
      (kind) => !allowed.includes(kind),
    );

    expect(stale).toEqual([]);
  });

  it('have a publisher for the free slots changing', () => {
    expect(UNBUILT).not.toHaveProperty(['garage.slots_changed']);
    expect(published('garage.slots_changed')).toBe(true);
  });
});
