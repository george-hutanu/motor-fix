import {
  chooseCar,
  JOB_SYSTEMS,
  MODEL_3D_KEY,
  matchesModel,
  systemsFor,
} from './car-models-3d';

// @traces 035-FR-002 035-FR-004

const logan = { model: 'Logan', rank: 1 };
const duster = { model: 'Duster', rank: 2 };

describe('matchesModel, hostile names', () => {
  it.each([
    ['', ''],
    ['   ', '   '],
    ['\t\n', ' '],
    ['', 'Logan'],
    ['Logan', ''],
  ])('never matches an empty name: %j against %j', (car, licensed) => {
    expect(matchesModel(car, licensed)).toBe(false);
  });

  it.each([
    ['seria 3', 'Seria 3'],
    ['Seria 3', 'Seria 3'],
    ['Seria\t\t3', 'Seria 3'],
    ['  Seria 3  ', 'Seria 3'],
    ['SERIA 3', 'Seria 3'],
    ['Şerie', 'Serie'],
    ['Țiriac', 'Tiriac'],
    ['Ţiriac', 'Țiriac'],
    ['Citroën', 'Citroën'],
    ['Citroën', 'Citroen'],
    ['Créta', 'Creta'],
  ])('matches %j with %j', (car, licensed) => {
    expect(matchesModel(car, licensed)).toBe(true);
  });

  it.each([
    ['320d', 'Seria 3'],
    ['Logan MCV', 'Logan'],
    ['Logan', 'Logan MCV'],
    ['Seria 3', 'Seria 30'],
    ['S3', 'Seria 3'],
    ['Logan-', 'Logan'],
    ['Lo.gan', 'Logan'],
    ['Logan\u0000', 'Logan'],
  ])('does not match %j with %j', (car, licensed) => {
    expect(matchesModel(car, licensed)).toBe(false);
  });

  it('matches a name ten thousand characters long with itself, quickly', () => {
    const long = `${'a '.repeat(5_000)}b`;
    expect(matchesModel(long, long.toUpperCase())).toBe(true);
  });

  it('is symmetric', () => {
    expect(matchesModel('Seria 3', 'seria  3')).toBe(
      matchesModel('seria  3', 'Seria 3'),
    );
  });
});

describe('chooseCar, edges', () => {
  it('answers the generic shape with no cars and no models', () => {
    expect(chooseCar([], [], 'estate')).toEqual({
      bodyStyle: 'estate',
      model: null,
      source: 'generic',
    });
  });

  it('answers the generic shape for own cars when the brand has no licensed model', () => {
    expect(chooseCar([{ model: 'Logan' }], [], 'suv')).toEqual({
      bodyStyle: 'suv',
      model: null,
      source: 'generic',
    });
  });

  it('answers the brand model for an empty own car list', () => {
    expect(chooseCar([], [logan, duster], 'saloon')).toEqual({
      model: logan,
      source: 'brand',
    });
  });

  it('skips an own car with an empty model name', () => {
    expect(
      chooseCar([{ model: '' }, { model: '   ' }], [logan], 'saloon'),
    ).toEqual({ model: logan, source: 'brand' });
  });

  it('answers the first own car in the order given, not the best ranked', () => {
    expect(
      chooseCar(
        [{ model: 'duster' }, { model: 'LOGAN' }],
        [logan, duster],
        'saloon',
      ),
    ).toEqual({ model: duster, source: 'own_car' });
  });

  it('returns the very model object it was given', () => {
    const chosen = chooseCar([{ model: 'Logan' }], [logan], 'saloon');
    expect(chosen.model).toBe(logan);
  });

  it('changes neither input', () => {
    const cars = [{ model: 'Duster' }, { model: 'Logan' }];
    const models = [logan, duster];
    const before = JSON.stringify([cars, models]);
    chooseCar(cars, models, 'saloon');
    expect(JSON.stringify([cars, models])).toBe(before);
  });

  it('gives the same answer twice', () => {
    const cars = [{ model: 'Spring' }];
    expect(chooseCar(cars, [logan], 'saloon')).toEqual(
      chooseCar(cars, [logan], 'saloon'),
    );
  });

  it('handles ten thousand own cars and still takes the first licensed one', () => {
    const cars = Array.from({ length: 10_000 }, (_, i) => ({
      model: i === 9_999 ? 'Duster' : `Unknown ${i}`,
    }));
    expect(chooseCar(cars, [logan, duster], 'saloon').model).toBe(duster);
  });
});

const SYSTEMS = [
  {
    code: 'tyres',
    fuelTypes: ['petrol', 'diesel', 'hybrid', 'electric'],
    nameEn: 'Tyres',
    nameRo: 'Anvelope',
    position: 3,
  },
  {
    code: 'engine',
    fuelTypes: ['petrol', 'diesel', 'hybrid'],
    nameEn: 'Engine',
    nameRo: 'Motor',
    position: 1,
  },
  {
    code: 'brakes',
    fuelTypes: ['petrol', 'diesel', 'hybrid', 'electric'],
    nameEn: 'Brakes',
    nameRo: 'Frane',
    position: 2,
  },
];

describe('systemsFor, edges', () => {
  it('answers an empty list for no systems', () => {
    expect(systemsFor([], 'petrol', [])).toEqual([]);
  });

  it('answers an empty list when no system holds the fuel', () => {
    expect(
      systemsFor([{ ...SYSTEMS[0], fuelTypes: ['electric'] }], 'diesel', []),
    ).toEqual([]);
  });

  it('answers an empty list for a fuel nobody knows', () => {
    expect(systemsFor(SYSTEMS, 'steam' as never, [])).toEqual([]);
  });

  it('orders by position whatever the order given, without reordering the input', () => {
    const input = [...SYSTEMS];
    expect(systemsFor(input, 'petrol', []).map((s) => s.code)).toEqual([
      'engine',
      'brakes',
      'tyres',
    ]);
    expect(input.map((s) => s.code)).toEqual(['tyres', 'engine', 'brakes']);
  });

  it('gives an electric car no engine', () => {
    expect(systemsFor(SYSTEMS, 'electric', []).map((s) => s.code)).toEqual([
      'brakes',
      'tyres',
    ]);
  });

  it('puts a job of a mapped category on every system that category lights', () => {
    const answer = systemsFor(
      [
        {
          code: 'engine',
          fuelTypes: ['petrol'],
          nameEn: 'E',
          nameRo: 'M',
          position: 1,
        },
        {
          code: 'exhaust',
          fuelTypes: ['petrol'],
          nameEn: 'X',
          nameRo: 'Ev',
          position: 2,
        },
      ],
      'petrol',
      [{ carSystem: 'engine', id: 'j1' }],
    );
    expect(answer.map((s) => s.jobTypeIds)).toEqual([['j1'], ['j1']]);
  });

  it('lights nothing for a job without a category, a general job or an unknown category', () => {
    const jobs = [
      { carSystem: null, id: 'a' },
      { carSystem: 'general', id: 'b' },
      { carSystem: '', id: 'c' },
      { carSystem: 'Engine', id: 'd' },
      { carSystem: 'warp_drive', id: 'e' },
    ];
    expect(
      systemsFor(SYSTEMS, 'petrol', jobs).map((s) => s.jobTypeIds),
    ).toEqual([[], [], []]);
  });

  it.each([
    'constructor',
    'toString',
    'hasOwnProperty',
    '__proto__',
    'valueOf',
  ])('lights nothing for a category called %j', (carSystem) => {
    expect(
      systemsFor(SYSTEMS, 'petrol', [{ carSystem, id: 'x' }]).map(
        (s) => s.jobTypeIds,
      ),
    ).toEqual([[], [], []]);
  });

  it('keeps the order the jobs are given in', () => {
    const jobs = ['c', 'a', 'b'].map((id) => ({ carSystem: 'engine', id }));
    expect(systemsFor(SYSTEMS, 'petrol', jobs)[0].jobTypeIds).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('carries no field beyond code, names and job ids', () => {
    expect(Object.keys(systemsFor(SYSTEMS, 'petrol', [])[0]).sort()).toEqual([
      'code',
      'jobTypeIds',
      'nameEn',
      'nameRo',
    ]);
  });

  it('answers a thousand jobs for one system in a single pass', () => {
    const jobs = Array.from({ length: 1_000 }, (_, i) => ({
      carSystem: 'brakes',
      id: `j${i}`,
    }));
    const brakes = systemsFor(SYSTEMS, 'petrol', jobs).find(
      (s) => s.code === 'brakes',
    );
    expect(brakes?.jobTypeIds).toHaveLength(1_000);
  });
});

describe('JOB_SYSTEMS, shape', () => {
  it('lights every system code from exactly one category', () => {
    const lit = Object.entries(JOB_SYSTEMS).flatMap(([, codes]) => [...codes]);
    expect(new Set(lit).size).toBe(lit.length);
    expect(lit.sort()).toEqual([
      'aircon',
      'battery',
      'bodywork',
      'brakes',
      'electric_motor',
      'electrics',
      'engine',
      'exhaust',
      'gearbox',
      'suspension',
      'tyres',
    ]);
  });
});

describe('MODEL_3D_KEY, hostile keys', () => {
  it.each([
    '.2099f2575d8f1377.glb',
    'a.b.2099f2575d8f1377.glb',
    'dacia-logan.2099f2575d8f1377.glb.glb',
    'dacia-logan.2099f2575d8f13770.glb',
    'dacia-logan.2099f2575d8f1377.GLB',
    ' dacia-logan.2099f2575d8f1377.glb',
    'dacia/logan.2099f2575d8f1377.glb',
    'dacia\\logan.2099f2575d8f1377.glb',
    'dacia-logan.2099f2575d8f1377.glb\u0000',
    'dacia-logan.2099f2575d8f1377.glb\r\n',
    'dacia-logan.２０９９f2575d8f1377.glb',
    'dacia-logan%2e2099f2575d8f1377.glb',
    'dacia-lögan.2099f2575d8f1377.glb',
    '',
  ])('refuses %j', (key) => {
    expect(MODEL_3D_KEY.test(key)).toBe(false);
  });

  it('is not sticky: the same key tests the same twice', () => {
    const key = 'dacia-logan.2099f2575d8f1377.glb';
    expect([MODEL_3D_KEY.test(key), MODEL_3D_KEY.test(key)]).toEqual([
      true,
      true,
    ]);
  });
});
