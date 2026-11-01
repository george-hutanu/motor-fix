// Checks the 3D car files against the catalogue in
// libs/domain/src/catalogue/models-3d/models-3d.ts, the data file, never the
// database: each GLB at most 2 MiB, its content matching the hash in its name,
// holding `body` and one `sys_<code>` and `pin_<code>` per system of its fuel
// and none of another; every catalogue row with its file, no file without a
// row. Prints one `<file>: <fault>` line per fault and exits 1 when any.
//
// With no directory it checks the licensed models' placeholders and the six
// generic files scripts/models-3d-generic.ts generates, so a generator or
// encoder change that moves one byte fails here until the keys follow; given
// the directory of the real files, it checks those.
//
//   node scripts/model-3d-check.ts [dir]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { generateGeneric } from '../libs/domain/src/catalogue/models-3d/generic/generic.ts';
import {
  checkModels3d,
  placeholders,
} from '../libs/domain/src/catalogue/models-3d/models-3d.ts';

function read(dir: string): Map<string, Uint8Array> {
  return new Map(
    readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => [
        entry.name,
        entry.isFile()
          ? new Uint8Array(readFileSync(join(dir, entry.name)))
          : new Uint8Array(),
      ]),
  );
}

async function generated(): Promise<Map<string, Uint8Array>> {
  const files = placeholders();
  for (const { bytes, name } of await generateGeneric()) files.set(name, bytes);
  return files;
}

async function main() {
  const { positionals } = parseArgs({ allowPositionals: true });
  const [dir] = positionals;
  if (
    dir !== undefined &&
    !statSync(dir, { throwIfNoEntry: false })?.isDirectory()
  ) {
    console.log(`${dir}: no such directory`);
    process.exitCode = 1;
    return;
  }
  const faults = checkModels3d(
    dir === undefined ? await generated() : read(dir),
  );
  for (const line of faults) console.log(line);
  if (faults.length > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('model-3d-check.ts')) await main();
