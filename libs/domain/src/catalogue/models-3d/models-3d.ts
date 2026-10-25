import { createHash } from 'node:crypto';

// The 3D car catalogue: the systems a car can light, the licensed models and
// the generic body shapes, each pointing at its GLB in object storage under
// models-3d/ by a key that names its content (<key>.<16 hex of SHA-256>.glb),
// so a key is never overwritten and is served immutable. The real files come
// from the 3D asset stories; until then the keys are those of the placeholders
// below. No workspace import, not even of a type: scripts/model-3d-check.ts
// runs and typechecks this file on its own, so the fuel and body-style unions
// are restated here and models-3d.spec.ts holds them equal to the originals.

type Fuel = 'petrol' | 'diesel' | 'hybrid' | 'electric';
type BodyStyle =
  | 'saloon'
  | 'hatchback'
  | 'suv'
  | 'crossover'
  | 'estate'
  | 'fastback';

export type CarSystemCode =
  | 'engine'
  | 'brakes'
  | 'suspension'
  | 'aircon'
  | 'exhaust'
  | 'gearbox'
  | 'electrics'
  | 'tyres'
  | 'bodywork'
  | 'electric_motor'
  | 'battery';

export interface CarSystemRecord {
  code: CarSystemCode;
  fuelTypes: readonly Fuel[];
  nameRo: string;
  nameEn: string;
  position: number;
}

const EVERY: readonly Fuel[] = ['petrol', 'diesel', 'hybrid', 'electric'];
const COMBUSTION: readonly Fuel[] = ['petrol', 'diesel', 'hybrid'];
const ELECTRIC: readonly Fuel[] = ['hybrid', 'electric'];

const system = (
  position: number,
  code: CarSystemCode,
  nameRo: string,
  nameEn: string,
  fuelTypes: readonly Fuel[],
): CarSystemRecord => ({ code, fuelTypes, nameEn, nameRo, position });

export const CAR_SYSTEM: readonly CarSystemRecord[] = [
  system(1, 'engine', 'Motor', 'Engine', COMBUSTION),
  system(2, 'brakes', 'Frâne', 'Brakes', EVERY),
  system(3, 'suspension', 'Suspensie', 'Suspension', EVERY),
  system(4, 'aircon', 'Climă', 'Air-con', EVERY),
  system(5, 'exhaust', 'Evacuare', 'Exhaust', COMBUSTION),
  system(6, 'gearbox', 'Cutie de viteze', 'Gearbox', COMBUSTION),
  system(7, 'electrics', 'Electrică', 'Electrics', EVERY),
  system(8, 'tyres', 'Anvelope', 'Tyres', EVERY),
  system(9, 'bodywork', 'Caroserie', 'Bodywork', EVERY),
  system(10, 'electric_motor', 'Motor electric', 'Electric motor', ELECTRIC),
  system(11, 'battery', 'Baterie', 'Battery', ELECTRIC),
];

// The node names a car of this fuel must hold: its body, then one part and
// one pin for each of its systems.
export function partsFor(fuel: Fuel): string[] {
  const codes = CAR_SYSTEM.filter((s) => s.fuelTypes.includes(fuel)).map(
    (s) => s.code,
  );
  return [
    'body',
    ...codes.map((code) => `sys_${code}`),
    ...codes.map((code) => `pin_${code}`),
  ];
}

// The car models MotorFix licenses for the 3D car: the most registered
// passenger-car families in Romania (DRPCIV "Parc auto", 31.12.2025), in that
// order. A key never changes once shipped. The licence itself (seller, terms,
// cost, renewal) is kept with the stored model, never here.
export interface LicensedCarModel {
  key: string;
  brand: string;
  model: string;
  fuel: Fuel;
  // Within the brand; rank 1 is the car shown when only the brand is picked.
  rank: number;
  bodyStyle: BodyStyle;
  // The GLB's key in object storage.
  file: string;
}

const row = (
  key: string,
  brand: string,
  model: string,
  fuel: Fuel,
  rank: number,
  bodyStyle: BodyStyle,
  hash: string,
): LicensedCarModel => ({
  bodyStyle,
  brand,
  file: `${key}.${hash}.glb`,
  fuel,
  key,
  model,
  rank,
});

// biome-ignore format: one line per model reads as the table it is
export const CAR_MODELS: readonly LicensedCarModel[] = [
  row('dacia-logan', 'dacia', 'Logan', 'petrol', 1, 'saloon', '2099f2575d8f1377'),
  row('volkswagen-golf', 'volkswagen', 'Golf', 'diesel', 1, 'hatchback', 'd9a3ef361eeaa3c6'),
  row('volkswagen-passat', 'volkswagen', 'Passat', 'diesel', 2, 'estate', 'a8f16bcc9981b032'),
  row('opel-astra', 'opel', 'Astra', 'diesel', 1, 'hatchback', '7a7f9d4023d8a36a'),
  row('ford-focus', 'ford', 'Focus', 'diesel', 1, 'hatchback', '192d5db6bf487095'),
  row('audi-a4', 'audi', 'A4', 'diesel', 1, 'saloon', '26f508853f7d547f'),
  row('skoda-octavia', 'skoda', 'Octavia', 'diesel', 1, 'estate', 'c15ebf7584bc6fce'),
  row('bmw-seria-3', 'bmw', 'Seria 3', 'diesel', 1, 'saloon', 'c4736b957a0d15f9'),
  row('dacia-duster', 'dacia', 'Duster', 'diesel', 2, 'suv', 'f09b1762fc5b4e07'),
  row('renault-megane', 'renault', 'Megane', 'diesel', 1, 'hatchback', '3095601d36c81603'),
  row('volkswagen-polo', 'volkswagen', 'Polo', 'petrol', 3, 'hatchback', '14439e6cb396e0eb'),
  row('skoda-fabia', 'skoda', 'Fabia', 'petrol', 2, 'hatchback', '60847c033f8702ff'),
  row('dacia-sandero', 'dacia', 'Sandero', 'petrol', 3, 'hatchback', 'f9d306f4c8b2befb'),
  row('bmw-seria-5', 'bmw', 'Seria 5', 'diesel', 2, 'saloon', '5e13e636e033d2c2'),
  row('ford-fiesta', 'ford', 'Fiesta', 'petrol', 2, 'hatchback', 'f64fbb394ffacf63'),
  row('opel-corsa', 'opel', 'Corsa', 'petrol', 2, 'hatchback', '8b5e8c105436bebd'),
  row('audi-a6', 'audi', 'A6', 'diesel', 2, 'saloon', 'f94860088a9127c1'),
  row('volkswagen-touran', 'volkswagen', 'Touran', 'diesel', 4, 'estate', 'aa31199f1af686c4'),
  row('volkswagen-tiguan', 'volkswagen', 'Tiguan', 'diesel', 5, 'suv', '0afa78603a1b5932'),
  row('renault-clio', 'renault', 'Clio', 'petrol', 2, 'hatchback', 'd49ee1a5d3811fd5'),
];

// The generic car of each body shape, shown for a brand with no licensed
// model; it holds the parts of a petrol car whatever the driver's fuel.
export const GENERIC_FILES: Readonly<Record<BodyStyle, string>> = {
  crossover: 'generic-crossover.2ce0e84d7428741a.glb',
  estate: 'generic-estate.85d30f114d353a88.glb',
  fastback: 'generic-fastback.845df5a7f01a1ad7.glb',
  hatchback: 'generic-hatchback.c488c5030005c2f6.glb',
  saloon: 'generic-saloon.b0a89639c822ab36.glb',
  suv: 'generic-suv.1a5c3c6515fc37bd.glb',
};

export interface Model3dFile {
  // The model key, or generic-<style>.
  key: string;
  file: string;
  // The fuel whose parts the file must hold.
  fuel: Fuel;
}

export const MODEL_3D_FILES: readonly Model3dFile[] = [
  ...CAR_MODELS.map(({ file, fuel, key }) => ({ file, fuel, key })),
  ...Object.entries(GENERIC_FILES).map(([style, file]) => ({
    file,
    fuel: 'petrol' as const,
    key: `generic-${style}`,
  })),
];

export const MODEL_3D_MAX_BYTES = 2_097_152;

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

const hash16 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16);

// A GLB holding only named, empty nodes; the same bytes for the same names.
export function glb(nodeNames: readonly string[], label?: string): Uint8Array {
  const json = JSON.stringify({
    asset: { generator: 'motor-fix placeholder', version: '2.0' },
    nodes: nodeNames.map((name) => ({ name })),
    scene: 0,
    scenes: [
      {
        ...(label === undefined ? {} : { name: label }),
        nodes: nodeNames.map((_, i) => i),
      },
    ],
  });
  const text = new TextEncoder().encode(json);
  const padded = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(20 + padded).fill(0x20, 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, JSON_CHUNK, true);
  bytes.set(text, 20);
  return bytes;
}

// One placeholder per catalogue file, under the key the catalogue holds.
export function placeholders(): Map<string, Uint8Array> {
  return new Map(
    MODEL_3D_FILES.map(({ file, fuel, key }) => [
      file,
      glb(partsFor(fuel), key),
    ]),
  );
}

// The node names of a GLB, or null when the bytes are not one.
function nodeNames(bytes: Uint8Array): string[] | null {
  if (bytes.length < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== GLB_MAGIC ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== JSON_CHUNK ||
    20 + length > bytes.length
  ) {
    return null;
  }
  try {
    const json = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(20, 20 + length),
      ),
    ) as { nodes?: { name?: unknown }[] };
    return (json.nodes ?? []).flatMap((node) =>
      typeof node?.name === 'string' ? [node.name] : [],
    );
  } catch {
    return null;
  }
}

// The parts a file lacks for its fuel, then the system parts it must not hold.
function partFaults(names: readonly string[], fuel: Fuel): string[] {
  const required = partsFor(fuel);
  const held = new Set(names);
  const allowed = new Set(required);
  return [
    ...required.filter((part) => !held.has(part)).map((p) => `missing ${p}`),
    ...names
      .filter((part) => /^(sys|pin)_/.test(part) && !allowed.has(part))
      .map((part) => `forbidden ${part}`),
  ];
}

function checkFile(name: string, bytes: Uint8Array, fuel: Fuel): string[] {
  const names = nodeNames(bytes);
  const faults = [
    ...(names === null ? ['not a GLB'] : []),
    ...(bytes.length > MODEL_3D_MAX_BYTES ? ['larger than 2 MiB'] : []),
    ...(name.endsWith(`.${hash16(bytes)}.glb`) ? [] : ['hash mismatch']),
    ...(names === null ? [] : partFaults(names, fuel)),
  ];
  return faults.map((fault) => `${name}: ${fault}`);
}

// Every fault of a set of 3D files against the catalogue, one
// "<file>: <fault>" line each: the files in the order given, then each
// catalogue row with no file. Empty when the set is whole and sound.
export function checkModels3d(
  files: ReadonlyMap<string, Uint8Array>,
  catalogue: readonly Model3dFile[] = MODEL_3D_FILES,
): string[] {
  const byFile = new Map(catalogue.map((row) => [row.file, row]));
  const lines: string[] = [];
  for (const [name, bytes] of files) {
    const row = byFile.get(name);
    if (row === undefined) lines.push(`${name}: unknown file`);
    else lines.push(...checkFile(name, bytes, row.fuel));
  }
  for (const { file, key } of catalogue) {
    if (!files.has(file)) lines.push(`${key}: missing file ${file}`);
  }
  return lines;
}
