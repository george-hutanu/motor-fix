import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { COCKPIT_COLOURS } from './generated/colours';

const css = readFileSync(join(__dirname, 'styles/cockpit.css'), 'utf8');
const generator = join(__dirname, '../scripts/colours.mjs');

const tokens = (block: string) =>
  Object.fromEntries(
    [...block.matchAll(/(--mf-[\w-]+)\s*:\s*([^;]+);/g)].map(
      ([, name, value]) => [name, value.trim()],
    ),
  );

const darkBlock = /^:root\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';
const lightBlock =
  /@media \(prefers-color-scheme: light\)[^{]*\{\s*:root\s*\{([^}]*)\}/.exec(
    css,
  )?.[1] ?? '';

describe('the generated Cockpit colours', () => {
  // @traces 517-FR-003
  it('are what the generator writes from cockpit.css today', () => {
    const check = spawnSync(process.execPath, [generator, '--check'], {
      encoding: 'utf8',
    });

    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
  });

  // @traces 517-FR-003
  it('hold each colour token of the light set, in both schemes', () => {
    const light = tokens(lightBlock);
    const dark = tokens(darkBlock);
    const names = Object.keys(light);

    expect(names).toContain('--mf-bg');
    expect(COCKPIT_COLOURS.light).toEqual(light);
    expect(COCKPIT_COLOURS.dark).toEqual(
      Object.fromEntries(names.map((name) => [name, dark[name]])),
    );
  });

  // @traces 517-FR-003
  it('leave out the tokens that are not colours', () => {
    expect(Object.keys(COCKPIT_COLOURS.dark)).not.toContain('--mf-size-body');
    expect(Object.keys(COCKPIT_COLOURS.dark)).not.toContain('--mf-safe-top');
  });
});
