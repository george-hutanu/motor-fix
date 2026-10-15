import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The store moved to Valkey 9. The repository's own documents say so
// on every run; the specs repo's pages only where its clone is checked out
// (a laptop, not CI, which never reads specs).

const root = join(import.meta.dirname, '..', '..');
const docs = join(root, '.motor-fix-specs', 'docs');
const read = (...parts) => readFileSync(join(...parts), 'utf8');

describe('the store in the documentation', () => {
  // @traces 1175-FR-012
  it('is Valkey 9 in AGENTS.md', () => {
    assert.match(read(root, 'AGENTS.md'), /PostgreSQL, Valkey 9 \(Redis protocol\)/);
  });

  // @traces 1175-FR-012
  it.skipIf(!existsSync(docs))('carries the dated ST-1175 note on every page that names the store', () => {
    for (const page of [
      'reference/stack.md',
      'explanation/architecture/system-overview.md',
      'explanation/decisions/a01.md',
      'explanation/decisions/a16.md',
      'explanation/decisions/a25.md',
      'explanation/decisions/index.md',
    ]) {
      assert.match(read(docs, page), /2026-10-15 \(ST-1175\):\*\* the store is Valkey 9/, page);
    }
  });

  // @traces 1175-FR-013
  it.skipIf(!existsSync(docs))("records the owner's Railway step in the release how-to", () => {
    const release = read(docs, 'how-to/release.md');
    assert.match(release, /## Move production's store to Valkey/);
    assert.match(release, /noeviction/);
    assert.match(release, /REDIS_URL/);
  });

  // @traces 1175-FR-014
  it('reads Redis in the living capabilities as the store, now Valkey 9', () => {
    assert.match(read(root, '.specify', 'capabilities', 'platform.md'), /that store is Valkey 9/);
  });
});
