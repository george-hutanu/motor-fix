import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// PR #99 renamed the root Biome config to biome.jsonc so a disabled rule can
// carry its reason as a comment. The rules agents read must name the file that
// exists. Sync Impact Report entries and specs/ are history and keep theirs.

const root = join(import.meta.dirname, '..', '..');
const stale = /\bbiome\.json(?!c)/;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const constitution = () => {
  const text = readFileSync(join(root, '.specify/memory/constitution.md'), 'utf8');
  return text.replace(/<!--[\s\S]*?-->/g, '');
};

describe('the harness docs name the root Biome config biome.jsonc', () => {
  it('no live harness text names biome.json', () => {
    const files = [
      join(root, 'AGENTS.md'),
      ...['.specify/contexts', '.claude/hooks', '.claude/agents', '.claude/skills'].flatMap((d) => walk(join(root, d))),
    ].filter((f) => /\.(md|sh|mjs|js)$/.test(f) && !f.endsWith('biome-config-name.spec.mjs'));
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => (stale.test(line) ? `${relative(root, f)}:${i + 1}` : null))
        .filter(Boolean),
    );
    const body = constitution();
    if (stale.test(body)) hits.push('.specify/memory/constitution.md (body)');
    assert.deepEqual(hits, []);
  });

  it('the constitution records the PATCH amendment', () => {
    const text = readFileSync(join(root, '.specify/memory/constitution.md'), 'utf8');
    const [major, minor, patch] = text.match(/\*\*Version\*\*: (\d+)\.(\d+)\.(\d+) /).slice(1).map(Number);
    assert.ok(major * 1e6 + minor * 1e3 + patch >= 1008002);
    assert.match(text, /Version change: 1\.8\.1 → 1\.8\.2/);
  });
});
