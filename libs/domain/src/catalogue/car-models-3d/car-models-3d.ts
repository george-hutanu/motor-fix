import {
  type BodyStyle,
  type CarModel3dSystemDto,
  type CarSystem,
  type Fuel,
  fold,
} from '@motor-fix/contracts';

// The 3D car's systems each catalogue job category lights: a job of the
// category shows its pin on every one of them. General jobs light none.
export const JOB_SYSTEMS: Readonly<Record<CarSystem, readonly string[]>> = {
  air_con: ['aircon'],
  body: ['bodywork'],
  brakes: ['brakes'],
  electrical: ['electrics', 'battery', 'electric_motor'],
  engine: ['engine', 'exhaust'],
  general: [],
  suspension_steering: ['suspension'],
  transmission: ['gearbox'],
  tyres_wheels: ['tyres'],
};

// A 3D file's key in the store: <name>.<16 hex of its SHA-256>.glb.
export const MODEL_3D_KEY = /^[a-z0-9-]+\.[0-9a-f]{16}\.glb$/;

const squeeze = (text: string) => fold(text).replace(/\s+/g, '');

// A driver types the model; the licence names it. "seria  3" is the "Seria 3".
export function matchesModel(carModel: string, licensedModel: string) {
  const car = squeeze(carModel);
  return car !== '' && car === squeeze(licensedModel);
}

export type ChosenCar<M> =
  | { source: 'own_car' | 'brand'; model: M }
  | { source: 'generic'; model: null; bodyStyle: BodyStyle };

// ownCars newest first, models by popularity (1 first).
export function chooseCar<M extends { model: string }>(
  ownCars: readonly { model: string }[],
  models: readonly M[],
  bodyStyle: BodyStyle,
): ChosenCar<M> {
  for (const car of ownCars) {
    const model = models.find((m) => matchesModel(car.model, m.model));
    if (model) return { model, source: 'own_car' };
  }
  if (models[0]) return { model: models[0], source: 'brand' };
  return { bodyStyle, model: null, source: 'generic' };
}

interface SystemRow {
  code: string;
  fuelTypes: readonly string[];
  nameRo: string;
  nameEn: string;
  position: number;
}

// The systems of the fuel by position, each with the approved jobs that light
// it, in the order the jobs are given.
export function systemsFor(
  systems: readonly SystemRow[],
  fuel: Fuel,
  jobs: readonly { id: string; carSystem: string | null }[],
): CarModel3dSystemDto[] {
  return systems
    .filter((s) => s.fuelTypes.includes(fuel))
    .sort((a, b) => a.position - b.position)
    .map(({ code, nameEn, nameRo, position }) => ({
      code,
      jobTypeIds: jobs
        .filter((job) =>
          (JOB_SYSTEMS[job.carSystem as CarSystem] ?? []).includes(code),
        )
        .map((job) => job.id),
      nameEn,
      nameRo,
      position,
    }));
}
