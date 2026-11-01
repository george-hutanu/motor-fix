import { CAR_SYSTEMS } from '@motor-fix/contracts';

import {
  chooseCar,
  JOB_SYSTEMS,
  MODEL_3D_KEY,
  matchesModel,
  systemsFor,
} from './car-models-3d';
import { CAR_SYSTEM, MODEL_3D_FILES } from '../models-3d/models-3d';

// @traces 035-FR-002 035-FR-003 035-FR-004 035-FR-011

const logan = {
  fileKey: 'dacia-logan.2099f2575d8f1377.glb',
  fuel: 'petrol',
  model: 'Logan',
} as const;
const duster = {
  fileKey: 'dacia-duster.f09b1762fc5b4e07.glb',
  fuel: 'diesel',
  model: 'Duster',
} as const;
const models = [logan, duster];

describe('chooseCar', () => {
  it('takes the first own car whose model is licensed, newest first', () => {
    expect(
      chooseCar([{ model: 'Duster' }, { model: 'Logan' }], models, 'saloon'),
    ).toEqual({ model: duster, source: 'own_car' });
  });

  it('skips an own car with an unlicensed model for the next licensed one', () => {
    expect(
      chooseCar([{ model: 'Spring' }, { model: 'Logan' }], models, 'saloon'),
    ).toEqual({ model: logan, source: 'own_car' });
  });

  it('falls to the most popular licensed model when no own car is licensed', () => {
    expect(chooseCar([{ model: 'Spring' }], models, 'saloon')).toEqual({
      model: logan,
      source: 'brand',
    });
    expect(chooseCar([], models, 'saloon')).toEqual({
      model: logan,
      source: 'brand',
    });
  });

  it('falls to the generic shape of the body style with no licensed model', () => {
    expect(chooseCar([{ model: 'Model 3' }], [], 'fastback')).toEqual({
      bodyStyle: 'fastback',
      model: null,
      source: 'generic',
    });
  });
});

describe('matchesModel', () => {
  it.each([
    ['Logan', 'Logan'],
    ['logan', 'Logan'],
    ['LOGAN', 'Logan'],
    ['Seria3', 'Seria 3'],
    [' seria  3 ', 'Seria 3'],
    ['Mégane', 'Megane'],
  ])('matches %j to %j', (car, row) => {
    expect(matchesModel(car, row)).toBe(true);
  });

  it.each([
    ['Logan MCV', 'Logan'],
    ['Log', 'Logan'],
    ['Seria 5', 'Seria 3'],
    ['', 'Logan'],
  ])('does not match %j to %j', (car, row) => {
    expect(matchesModel(car, row)).toBe(false);
  });
});

describe('systemsFor', () => {
  const codes = (fuel: 'petrol' | 'diesel' | 'electric' | 'hybrid') =>
    systemsFor(CAR_SYSTEM, fuel, []).map((s) => s.code);

  it('lists nine systems for petrol and diesel, eight for electric, eleven for hybrid, by position', () => {
    const combustion = [
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
    expect(codes('petrol')).toEqual(combustion);
    expect(codes('diesel')).toEqual(combustion);
    expect(codes('electric')).toEqual([
      'brakes',
      'suspension',
      'aircon',
      'electrics',
      'tyres',
      'bodywork',
      'electric_motor',
      'battery',
    ]);
    expect(codes('hybrid')).toEqual([
      ...combustion,
      'electric_motor',
      'battery',
    ]);
  });

  it('carries each system’s names and position, and no job when none is approved', () => {
    expect(systemsFor(CAR_SYSTEM, 'petrol', [])[0]).toEqual({
      code: 'engine',
      jobTypeIds: [],
      nameEn: 'Engine',
      nameRo: 'Motor',
      position: 1,
    });
  });

  it('attaches the approved jobs of each system in the order given', () => {
    const jobs = [
      { carSystem: 'electrical', id: 'j-alternator' },
      { carSystem: 'engine', id: 'j-belt' },
      { carSystem: 'general', id: 'j-check' },
      { carSystem: 'electrical', id: 'j-wiring' },
      { carSystem: 'air_con', id: 'j-recharge' },
    ];
    const byCode = Object.fromEntries(
      systemsFor(CAR_SYSTEM, 'hybrid', jobs).map((s) => [s.code, s.jobTypeIds]),
    );

    expect(byCode).toEqual({
      aircon: ['j-recharge'],
      battery: ['j-alternator', 'j-wiring'],
      bodywork: [],
      brakes: [],
      electric_motor: ['j-alternator', 'j-wiring'],
      electrics: ['j-alternator', 'j-wiring'],
      engine: ['j-belt'],
      exhaust: ['j-belt'],
      gearbox: [],
      suspension: [],
      tyres: [],
    });
  });
});

describe('JOB_SYSTEMS', () => {
  it('maps every job category to the systems it lights', () => {
    expect(JOB_SYSTEMS).toEqual({
      air_con: ['aircon'],
      body: ['bodywork'],
      brakes: ['brakes'],
      electrical: ['electrics', 'battery', 'electric_motor'],
      engine: ['engine', 'exhaust'],
      general: [],
      suspension_steering: ['suspension'],
      transmission: ['gearbox'],
      tyres_wheels: ['tyres'],
    });
    expect(Object.keys(JOB_SYSTEMS).sort()).toEqual([...CAR_SYSTEMS].sort());
  });
});

describe('MODEL_3D_KEY', () => {
  it('takes every catalogue file key', () => {
    for (const { file } of MODEL_3D_FILES)
      expect(MODEL_3D_KEY.test(file)).toBe(true);
  });

  it.each([
    'dacia-logan.2099f2575d8f137.glb',
    'dacia-logan.2099F2575D8F1377.glb',
    'dacia-logan.2099f2575d8f1377.gltf',
    '../dacia-logan.2099f2575d8f1377.glb',
    'Dacia-logan.2099f2575d8f1377.glb',
    'dacia-logan.2099f2575d8f1377.glb\n',
  ])('refuses %j', (key) => {
    expect(MODEL_3D_KEY.test(key)).toBe(false);
  });
});
