import { createHash } from 'node:crypto';

import type { Fuel } from '@motor-fix/contracts';

import {
  CAR_SYSTEM,
  checkModels3d,
  GENERIC_FILES,
  glb,
  MODEL_3D_FILES,
  partsFor,
  placeholders,
} from './models-3d';

const hash16 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16);

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

// Builds a GLB by hand so the header and chunk can be corrupted one field at a time.
function rawGlb(
  json: string | Uint8Array,
  opts: {
    version?: number;
    length?: number;
    chunkType?: number;
    chunkLength?: number;
  } = {},
): Uint8Array {
  const body = typeof json === 'string' ? new TextEncoder().encode(json) : json;
  const padded = Math.ceil(body.length / 4) * 4;
  const out = new Uint8Array(20 + padded).fill(0x20);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, opts.version ?? 2, true);
  view.setUint32(8, opts.length ?? out.length, true);
  view.setUint32(12, opts.chunkLength ?? padded, true);
  view.setUint32(16, opts.chunkType ?? 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}

const asJson = (nodes: unknown) =>
  JSON.stringify({ asset: { version: '2.0' }, nodes });

function one(fuel: Fuel, bytes: Uint8Array, key = 'car') {
  const file = `${key}.${hash16(bytes)}.glb`;
  return {
    catalogue: [{ file, fuel, key }],
    file,
    files: new Map([[file, bytes]]),
  };
}

const good = () => partsFor('petrol').map((name) => ({ name }));

describe('the 3D catalogue data, attacked', () => {
  // @traces 1241-FR-001
  it('hands out a fresh parts list so editing one result cannot change the next', () => {
    const first = partsFor('petrol');
    first.push('sys_intruder');
    first.shift();

    expect(partsFor('petrol')).toEqual(partsFor('diesel'));
    expect(partsFor('petrol')[0]).toBe('body');
    expect(partsFor('petrol')).not.toContain('sys_intruder');
  });

  // @traces 1241-FR-001
  it('keeps every system code, position and name unique', () => {
    expect(new Set(CAR_SYSTEM.map((s) => s.code)).size).toBe(11);
    expect(CAR_SYSTEM.map((s) => s.position)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(new Set(CAR_SYSTEM.map((s) => s.nameEn)).size).toBe(11);
  });

  // @traces 1241-FR-004
  it('gives no two catalogue rows the same file or key', () => {
    expect(new Set(MODEL_3D_FILES.map((r) => r.file)).size).toBe(
      MODEL_3D_FILES.length,
    );
    expect(new Set(MODEL_3D_FILES.map((r) => r.key)).size).toBe(
      MODEL_3D_FILES.length,
    );
    expect(MODEL_3D_FILES).toHaveLength(26);
  });

  // @traces 1241-FR-006
  it('keeps every placeholder under the size cap', () => {
    for (const bytes of placeholders().values()) {
      expect(bytes.byteLength).toBeLessThanOrEqual(2_097_152);
    }
  });

  // @traces 1241-FR-006
  it('generates different bytes for different node names and for different labels', () => {
    expect(hash16(glb(['body']))).not.toBe(hash16(glb(['body', 'sys_engine'])));
    expect(hash16(glb(['body'], 'a'))).not.toBe(hash16(glb(['body'], 'b')));
    expect(glb(['body'], 'a')).toEqual(glb(['body'], 'a'));
  });

  // @traces 1241-FR-006
  it('survives non-ASCII node names and a very long node list in the generator', () => {
    const names = Array.from({ length: 10_000 }, (_, i) => `nød_${i}_ăîșț`);

    expect(glb(names)).toEqual(glb(names));
    expect(glb(['body']).byteLength % 4).toBe(0);
  });
});

describe('the 3D asset check, attacked', () => {
  // @traces 1241-FR-007
  it('reports nothing for an empty file set against an empty catalogue', () => {
    expect(checkModels3d(new Map(), [])).toEqual([]);
  });

  // @traces 1241-FR-007
  it('names every file as unknown when the catalogue is empty', () => {
    const { file, files } = one('petrol', glb(partsFor('petrol')));

    expect(checkModels3d(files, [])).toEqual([`${file}: unknown file`]);
  });

  // @traces 1241-FR-007
  it('does not mutate the file set it is given and gives the same answer twice', () => {
    const { catalogue, files } = one(
      'petrol',
      glb(partsFor('petrol').slice(1)),
    );
    const before = [...files.keys()];

    const first = checkModels3d(files, catalogue);
    const second = checkModels3d(files, catalogue);

    expect(first).toEqual([`car.${before[0].split('.')[1]}.glb: missing body`]);
    expect(second).toEqual(first);
    expect([...files.keys()]).toEqual(before);
  });

  // @traces 1241-FR-007
  it.each([
    ['an empty file', new Uint8Array(0)],
    ['eleven bytes, short of a header', rawGlb('{}').slice(0, 11)],
    ['a header with no chunk', rawGlb('{}').slice(0, 12)],
    [
      'a UTF-16 text file with a byte order mark',
      new Uint8Array([0xff, 0xfe, ...new TextEncoder().encode('b\0o\0d\0y\0')]),
    ],
    [
      'a UTF-8 text file with a byte order mark',
      new TextEncoder().encode('﻿{"nodes":[]}'),
    ],
    [
      'a Latin-1 text file',
      Uint8Array.from([0x63, 0x61, 0x72, 0xe9, 0xe8, 0xff]),
    ],
    [
      'a PNG',
      Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0xd,
      ]),
    ],
    ['a version 1 container', rawGlb(asJson(good()), { version: 1 })],
    ['a version 3 container', rawGlb(asJson(good()), { version: 3 })],
    [
      'a first chunk that is not JSON',
      rawGlb(asJson(good()), { chunkType: 0x004e4942 }),
    ],
    [
      'a JSON chunk longer than the file',
      rawGlb(asJson(good()), { chunkLength: 0x7fffffff }),
    ],
    [
      'a header length longer than the file',
      rawGlb(asJson(good()), { length: 0xffffffff }),
    ],
    ['a JSON chunk that does not parse', rawGlb('{"nodes": [')],
    ['a JSON chunk holding null', rawGlb('null')],
    [
      'a JSON chunk holding invalid UTF-8',
      rawGlb(Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d])),
    ],
  ])('names %s as not a GLB and judges no part on it', (_label, bytes) => {
    const { catalogue, file, files } = one('petrol', bytes);

    expect(checkModels3d(files, catalogue)).toEqual([`${file}: not a GLB`]);
  });

  // @traces 1241-FR-007
  it('fails a GLB with no nodes key by naming its missing body, never by throwing', () => {
    const { catalogue, file, files } = one(
      'petrol',
      rawGlb('{"asset":{"version":"2.0"}}'),
    );

    const lines = checkModels3d(files, catalogue);

    expect(lines).toContain(`${file}: missing body`);
    expect(lines.every((l) => l.startsWith(`${file}: `))).toBe(true);
  });

  // glTF 2.0 holds its nodes in an array: any other shape is not a GLB.
  // @traces 1241-FR-007
  it.each([
    ['nodes that is not an array', asJson('body')],
    ['nodes that is an object', asJson({ body: 1 })],
  ])('names a GLB with %s as not a GLB, never throwing', (_label, json) => {
    const { catalogue, file, files } = one('petrol', rawGlb(json));

    expect(checkModels3d(files, catalogue)).toEqual([`${file}: not a GLB`]);
  });

  // @traces 1241-FR-007
  it('ignores nodes with no name, a numeric name or a null entry and still finds the real ones', () => {
    const nodes = [
      ...good(),
      {},
      { name: 42 },
      null,
      { name: null },
      'body',
      [],
    ];
    const { catalogue, files } = one('petrol', rawGlb(asJson(nodes)));

    expect(checkModels3d(files, catalogue)).toEqual([]);
  });

  // @traces 1241-FR-007
  it('treats node names as case sensitive', () => {
    const nodes = good().map((n) => ({
      name: n.name === 'body' ? 'Body' : n.name,
    }));
    const { catalogue, file, files } = one('petrol', rawGlb(asJson(nodes)));

    expect(checkModels3d(files, catalogue)).toContain(`${file}: missing body`);
  });

  // @traces 1241-FR-007
  it.each(['sys_flux', 'pin_flux', 'sys_', 'pin_', 'sys_engine_2'])(
    'names an unknown part %s as forbidden',
    (part) => {
      const { catalogue, file, files } = one(
        'petrol',
        rawGlb(asJson([...good(), { name: part }])),
      );

      expect(checkModels3d(files, catalogue)).toEqual([
        `${file}: forbidden ${part}`,
      ]);
    },
  );

  // @traces 1241-FR-007
  it.each(['sys_exhaust', 'pin_exhaust', 'sys_gearbox', 'pin_engine'])(
    'names %s on an electric car as forbidden',
    (part) => {
      const bytes = glb([...partsFor('electric'), part]);
      const { catalogue, file, files } = one('electric', bytes);

      expect(checkModels3d(files, catalogue)).toEqual([
        `${file}: forbidden ${part}`,
      ]);
    },
  );

  // @traces 1241-FR-007
  it.each(['sys_battery', 'pin_electric_motor'])(
    'names %s on a petrol car as forbidden',
    (part) => {
      const { catalogue, file, files } = one(
        'petrol',
        glb([...partsFor('petrol'), part]),
      );

      expect(checkModels3d(files, catalogue)).toEqual([
        `${file}: forbidden ${part}`,
      ]);
    },
  );

  // @traces 1241-FR-007
  it('does not forbid ordinary extra nodes whose names are not sys_ or pin_ parts', () => {
    const { catalogue, files } = one(
      'petrol',
      glb([...partsFor('petrol'), 'trim', 'system_x', 'Sys_engine', 'mypin_x']),
    );

    expect(checkModels3d(files, catalogue)).toEqual([]);
  });

  // @traces 1241-FR-007
  it('names a part only once when the file holds it twice', () => {
    const { catalogue, files } = one(
      'petrol',
      glb([...partsFor('petrol'), 'body', 'sys_engine']),
    );

    expect(checkModels3d(files, catalogue)).toEqual([]);
  });

  // @traces 1241-FR-007
  it('names a duplicated forbidden part once or twice but never as missing', () => {
    const { catalogue, file, files } = one(
      'electric',
      glb([...partsFor('electric'), 'sys_exhaust', 'sys_exhaust']),
    );
    const lines = checkModels3d(files, catalogue);

    expect(lines.every((l) => l === `${file}: forbidden sys_exhaust`)).toBe(
      true,
    );
    expect(lines.length).toBeGreaterThan(0);
  });

  // @traces 1241-FR-007
  it('reports every missing part when the file holds only a body', () => {
    const { catalogue, file, files } = one('petrol', glb(['body']));

    expect(checkModels3d(files, catalogue)).toEqual(
      expect.arrayContaining([
        ...NINE.map((c) => `${file}: missing sys_${c}`),
        ...NINE.map((c) => `${file}: missing pin_${c}`),
      ]),
    );
    expect(checkModels3d(files, catalogue)).toHaveLength(18);
  });

  // @traces 1241-FR-007
  it('holds a generic body style to the nine of a petrol car and forbids a battery on it', () => {
    const style = Object.keys(GENERIC_FILES)[0] as keyof typeof GENERIC_FILES;
    const bytes = glb([...partsFor('petrol'), 'sys_battery']);
    const file = `generic-${style}.${hash16(bytes)}.glb`;

    expect(
      checkModels3d(new Map([[file, bytes]]), [
        { file, fuel: 'petrol', key: `generic-${style}` },
      ]),
    ).toEqual([`${file}: forbidden sys_battery`]);
  });

  // @traces 1241-FR-007
  it('passes a hybrid file holding all eleven systems', () => {
    const { catalogue, files } = one('hybrid', glb(partsFor('hybrid')));

    expect(partsFor('hybrid')).toHaveLength(1 + 22);
    expect(checkModels3d(files, catalogue)).toEqual([]);
  });

  // @traces 1241-FR-007
  it.each([2_097_151, 2_097_152, 2_097_153, 30 * 1024 * 1024])(
    'judges a %i byte file by the 2 MiB cap alone',
    (size) => {
      const bytes = new Uint8Array(size);
      bytes.set(glb(partsFor('petrol')));
      new DataView(bytes.buffer).setUint32(8, size, true);
      const { catalogue, file, files } = one('petrol', bytes);

      expect(checkModels3d(files, catalogue)).toEqual(
        size > 2_097_152 ? [`${file}: larger than 2 MiB`] : [],
      );
    },
  );

  // @traces 1241-FR-007
  it('names a file whose name carries an uppercase or too short hash as a hash mismatch', () => {
    const bytes = glb(partsFor('petrol'));
    const h = hash16(bytes);
    const upper = `car.${h.toUpperCase()}.glb`;
    const short = `car.${h.slice(0, 15)}.glb`;
    const catalogue = [
      { file: upper, fuel: 'petrol' as const, key: 'a' },
      { file: short, fuel: 'petrol' as const, key: 'b' },
    ];

    expect(
      checkModels3d(
        new Map([
          [upper, bytes],
          [short, bytes],
        ]),
        catalogue,
      ),
    ).toEqual([`${upper}: hash mismatch`, `${short}: hash mismatch`]);
  });

  // @traces 1241-FR-007
  it.each([
    '../escape.glb',
    '/etc/passwd',
    'sub/dir.glb',
    '',
    ' ',
    'CAR.glb',
    'ünï.cödé.glb',
  ])('names the stray file %j as unknown without throwing', (name) => {
    expect(checkModels3d(new Map([[name, glb(['body'])]]), [])).toEqual([
      `${name}: unknown file`,
    ]);
  });

  // @traces 1241-FR-007
  it('names a missing row once even when two files in the set are strays', () => {
    const row = {
      file: `car.${'0'.repeat(16)}.glb`,
      fuel: 'petrol' as const,
      key: 'car',
    };
    const lines = checkModels3d(
      new Map([
        ['a.glb', glb([])],
        ['b.glb', glb([])],
      ]),
      [row],
    );

    expect(lines).toEqual([
      'a.glb: unknown file',
      'b.glb: unknown file',
      `car: missing file ${row.file}`,
    ]);
  });

  // @traces 1241-FR-007
  it('names the last byte tampered in a placeholder as a hash mismatch and nothing else', () => {
    const files = placeholders();
    const [name, bytes] = [...files][0];
    const tampered = bytes.slice();
    tampered[tampered.length - 1] ^= 0xff;
    files.set(name, tampered);

    expect(checkModels3d(files)).toContain(`${name}: hash mismatch`);
  });

  // @traces 1241-FR-007
  it('names every row of the catalogue as missing in catalogue order for an empty set', () => {
    expect(checkModels3d(new Map())).toEqual(
      MODEL_3D_FILES.map((r) => `${r.key}: missing file ${r.file}`),
    );
  });
});
