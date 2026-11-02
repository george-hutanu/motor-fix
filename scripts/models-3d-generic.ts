// The six generic body-shape 3D files: one GLB per body style,
// generated from code alone, so the files are an original work with no
// third-party content. The shapes are the design mock's procedural car
// (docs/reference/design/Main.dc.html) without paint, grille or badge.
//
//   node scripts/models-3d-generic.ts <dir>
//
// writes generic-<style>.<hash16>.glb into <dir> and prints the names. The
// bytes are the same on every run: a changed byte changes the name, which the
// asset check (scripts/model-3d-check.ts) then refuses against the catalogue.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateGeneric } from '../libs/domain/src/catalogue/models-3d/generic/generic.ts';

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error(
      'usage: node scripts/models-3d-generic.ts <output directory>',
    );
    process.exit(2);
  }
  mkdirSync(dir, { recursive: true });
  for (const file of await generateGeneric()) {
    writeFileSync(join(dir, file.name), file.bytes);
    console.log(file.name);
  }
}

if (process.argv[1]?.endsWith('models-3d-generic.ts')) await main();
