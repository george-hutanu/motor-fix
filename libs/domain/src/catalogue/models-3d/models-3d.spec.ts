import { createHash } from 'node:crypto';

import type { Fuel } from '@motor-fix/contracts';

import {
  CAR_MODELS,
  CAR_SYSTEM,
  checkModels3d,
  GENERIC_FILES,
  glb,
  MODEL_3D_FILES,
  partsFor,
  placeholders,
} from './models-3d';
import type { BodyStyle } from '../brands/brands';

const NINE = [
  'engine',
  'brakes',
  'suspension',
  'aircon',
  'exhaust',
  'gearbox',
  'electrics',
  'tyres',
  'bodywork',
];

const ELECTRIC = [
  'brakes',
  'suspension',
  'aircon',
  'electrics',
  'tyres',
  'bodywork',
  'electric_motor',
  'battery',
];

const nodes = (codes: readonly string[]) => [
  'body',
  ...codes.map((code) => `sys_${code}`),
  ...codes.map((code) => `pin_${code}`),
];

const hash16 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16);

// One catalogue row and its file, named by its key and the hash of its bytes.
function model(key: string, fuel: Fuel, bytes: Uint8Array) {
  const file = `${key}.${hash16(bytes)}.glb`;
  return {
    catalogue: [{ file, fuel, key }],
    file,
    files: new Map([[file, bytes]]),
  };
}

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe('the 3D catalogue file', () => {
  // @traces 1241-FR-004
  it('knows the same fuels as the car file and the same body styles as the brand file', () => {
    const fuels: Same<Fuel, Parameters<typeof partsFor>[0]> = true;
    const styles: Same<BodyStyle, keyof typeof GENERIC_FILES> = true;

    expect([fuels, styles]).toEqual([true, true]);
  });
});

describe('the car systems the 3D car can light', () => {
  // @traces 1241-FR-001
  it('are the nine of a petrol car, then the electric motor and the battery, each named in Romanian and English', () => {
    expect(
      CAR_SYSTEM.map((s) => [s.position, s.code, s.nameRo, s.nameEn]),
    ).toEqual([
      [1, 'engine', 'Motor', 'Engine'],
      [2, 'brakes', 'Frâne', 'Brakes'],
      [3, 'suspension', 'Suspensie', 'Suspension'],
      [4, 'aircon', 'Climă', 'Air-con'],
      [5, 'exhaust', 'Evacuare', 'Exhaust'],
      [6, 'gearbox', 'Cutie de viteze', 'Gearbox'],
      [7, 'electrics', 'Electrică', 'Electrics'],
      [8, 'tyres', 'Anvelope', 'Tyres'],
      [9, 'bodywork', 'Caroserie', 'Bodywork'],
      [10, 'electric_motor', 'Motor electric', 'Electric motor'],
      [11, 'battery', 'Baterie', 'Battery'],
    ]);
  });

  // @traces 1241-FR-001
  it.each([
    ['petrol', NINE],
    ['diesel', NINE],
    ['electric', ELECTRIC],
    ['hybrid', [...NINE, 'electric_motor', 'battery']],
  ] as const)(
    'give a %s car the body, a part and a pin for each of its systems',
    (fuel, codes) => {
      expect(partsFor(fuel)).toEqual(nodes(codes));
    },
  );
});

describe('the 3D files the catalogue points at', () => {
  // @traces 1241-FR-004
  it('name every licensed model and every generic body style by its key and the hash of its content', () => {
    for (const { key, file } of CAR_MODELS) {
      expect(file).toMatch(new RegExp(`^${key}\\.[0-9a-f]{16}\\.glb$`));
    }
    expect(Object.keys(GENERIC_FILES).sort()).toEqual([
      'crossover',
      'estate',
      'fastback',
      'hatchback',
      'saloon',
      'suv',
    ]);
    for (const [style, file] of Object.entries(GENERIC_FILES)) {
      expect(file).toMatch(
        new RegExp(`^generic-${style}\\.[0-9a-f]{16}\\.glb$`),
      );
    }
  });

  // @traces 1241-FR-008
  it('hold a generic body style to the parts of a petrol car', () => {
    expect(
      MODEL_3D_FILES.filter((row) => row.key.startsWith('generic-')).map(
        (row) => row.fuel,
      ),
    ).toEqual(Array(6).fill('petrol'));
  });

  // @traces 1241-FR-008
  it('refuse a battery on a generic body style, held to the nine systems', () => {
    const { catalogue, file, files } = model(
      'generic-saloon',
      'petrol',
      glb([...partsFor('petrol'), 'sys_battery']),
    );

    expect(checkModels3d(files, catalogue)).toEqual([
      `${file}: forbidden sys_battery`,
    ]);
  });

  // @traces 1241-FR-006
  // @traces 1242-FR-007
  it('are, for the licensed models until their real files arrive, placeholders made the same way every time under the keys the catalogue holds', () => {
    const first = placeholders();
    const again = placeholders();

    expect([...first.keys()].sort()).toEqual(
      CAR_MODELS.map((row) => row.file).sort(),
    );
    for (const [file, bytes] of first) {
      expect(again.get(file)).toEqual(bytes);
      expect(file).toContain(`.${hash16(bytes)}.glb`);
    }
    // The generic rows have their generated files (scripts/models-3d-generic.ts).
    expect(checkModels3d(first)).toEqual(
      Object.entries(GENERIC_FILES).map(
        ([style, file]) => `generic-${style}: missing file ${file}`,
      ),
    );
  });
});

describe('the 3D asset check', () => {
  // @traces 1241-FR-007
  it.each([
    ['petrol', NINE],
    ['electric', ELECTRIC],
    ['hybrid', [...NINE, 'electric_motor', 'battery']],
  ] as const)(
    'passes a %s car with its body and every part and pin',
    (fuel, codes) => {
      const { catalogue, files } = model('car', fuel, glb(nodes(codes)));

      expect(checkModels3d(files, catalogue)).toEqual([]);
    },
  );

  // @traces 1241-FR-007
  // @traces 1241-FR-009
  it.each(['sys_brakes', 'pin_brakes', 'body'])(
    'names the file and its missing %s',
    (part) => {
      const { catalogue, file, files } = model(
        'car',
        'diesel',
        glb(nodes(NINE).filter((n) => n !== part)),
      );

      expect(checkModels3d(files, catalogue)).toEqual([
        `${file}: missing ${part}`,
      ]);
    },
  );

  // @traces 1241-FR-007
  it('names an exhaust on an electric car as forbidden', () => {
    const { catalogue, file, files } = model(
      'car',
      'electric',
      glb([...nodes(ELECTRIC), 'sys_exhaust']),
    );

    expect(checkModels3d(files, catalogue)).toEqual([
      `${file}: forbidden sys_exhaust`,
    ]);
  });

  // @traces 1241-FR-007
  it('holds a hybrid to its battery as well as its engine', () => {
    const { catalogue, file, files } = model(
      'car',
      'hybrid',
      glb(nodes([...NINE, 'electric_motor'])),
    );

    expect(checkModels3d(files, catalogue)).toEqual([
      `${file}: missing sys_battery`,
      `${file}: missing pin_battery`,
    ]);
  });

  // @traces 1241-FR-007
  it('names a file that is not a GLB', () => {
    const { catalogue, file, files } = model(
      'car',
      'petrol',
      new TextEncoder().encode('not a model at all'),
    );

    expect(checkModels3d(files, catalogue)).toEqual([`${file}: not a GLB`]);
  });

  // @traces 1241-FR-007
  it('passes a file of exactly 2 MiB and names one a byte larger', () => {
    const padded = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set(glb(nodes(NINE)));
      new DataView(bytes.buffer).setUint32(8, size, true);
      return bytes;
    };
    const exact = model('car', 'petrol', padded(2_097_152));
    const over = model('car', 'petrol', padded(2_097_153));

    expect(checkModels3d(exact.files, exact.catalogue)).toEqual([]);
    expect(checkModels3d(over.files, over.catalogue)).toEqual([
      `${over.file}: larger than 2 MiB`,
    ]);
  });

  // @traces 1241-FR-007
  it('names a file whose content does not match the hash in its name', () => {
    const { catalogue, file } = model('car', 'petrol', glb(nodes(NINE)));
    const files = new Map([[file, glb([...nodes(NINE), 'trim'])]]);

    expect(checkModels3d(files, catalogue)).toEqual([`${file}: hash mismatch`]);
  });

  // @traces 1241-FR-007
  // @traces 1241-FR-009
  it('names a catalogue row with no file, and a file no row names', () => {
    const kept = model('kept', 'petrol', glb(nodes(NINE)));
    const gone = model('gone', 'petrol', glb(nodes(NINE).concat('trim')));
    const stray = model('stray', 'petrol', glb(nodes(NINE)));

    expect(
      checkModels3d(new Map([...kept.files, ...stray.files]), [
        ...kept.catalogue,
        ...gone.catalogue,
      ]),
    ).toEqual([
      `${stray.file}: unknown file`,
      `gone: missing file ${gone.file}`,
    ]);
  });

  // @traces 1241-FR-007
  it('names every row of the catalogue when it is given no file', () => {
    expect(checkModels3d(new Map())).toHaveLength(MODEL_3D_FILES.length);
  });
});
