import { FUELS, type Fuel } from '@motor-fix/contracts';

import { type BodyStyle, BRANDS } from './brands';

// The car models MotorFix licenses for the 3D car: the most registered
// passenger-car families in Romania (DRPCIV "Parc auto", 31.12.2025), in that
// order. A key never changes once shipped. The licence itself (seller, terms,
// cost, renewal) is kept with the stored model, never here.
interface LicensedCarModel {
  key: string;
  brand: string;
  model: string;
  fuel: Fuel;
  // Within the brand; rank 1 is the car shown when only the brand is picked.
  rank: number;
}

export type CarForBrand =
  | { kind: 'licensed'; model: LicensedCarModel }
  | { kind: 'generic'; bodyStyle: BodyStyle };

const row = (
  key: string,
  brand: string,
  model: string,
  fuel: Fuel,
  rank: number,
): LicensedCarModel => ({ brand, fuel, key, model, rank });

export const CAR_MODELS: readonly LicensedCarModel[] = [
  row('dacia-logan', 'dacia', 'Logan', 'petrol', 1),
  row('volkswagen-golf', 'volkswagen', 'Golf', 'diesel', 1),
  row('volkswagen-passat', 'volkswagen', 'Passat', 'diesel', 2),
  row('opel-astra', 'opel', 'Astra', 'diesel', 1),
  row('ford-focus', 'ford', 'Focus', 'diesel', 1),
  row('audi-a4', 'audi', 'A4', 'diesel', 1),
  row('skoda-octavia', 'skoda', 'Octavia', 'diesel', 1),
  row('bmw-seria-3', 'bmw', 'Seria 3', 'diesel', 1),
  row('dacia-duster', 'dacia', 'Duster', 'diesel', 2),
  row('renault-megane', 'renault', 'Megane', 'diesel', 1),
  row('volkswagen-polo', 'volkswagen', 'Polo', 'petrol', 3),
  row('skoda-fabia', 'skoda', 'Fabia', 'petrol', 2),
  row('dacia-sandero', 'dacia', 'Sandero', 'petrol', 3),
  row('bmw-seria-5', 'bmw', 'Seria 5', 'diesel', 2),
  row('ford-fiesta', 'ford', 'Fiesta', 'petrol', 2),
  row('opel-corsa', 'opel', 'Corsa', 'petrol', 2),
  row('audi-a6', 'audi', 'A6', 'diesel', 2),
  row('volkswagen-touran', 'volkswagen', 'Touran', 'diesel', 4),
  row('volkswagen-tiguan', 'volkswagen', 'Tiguan', 'diesel', 5),
  row('renault-clio', 'renault', 'Clio', 'petrol', 2),
];

export class CarModelFileError extends Error {}

// The first fault wins, in this order, so a file with several is fixed one
// message at a time.
export function validateCarModels(models: readonly LicensedCarModel[]) {
  refuseDuplicateKeys(models);
  const byBrand = Map.groupBy(models, (model) => model.brand);
  for (const [brand, own] of byBrand) refuseSharedRank(brand, own);
  for (const [brand, own] of byBrand) refuseRankGap(brand, own);
  for (const { key, fuel } of models) {
    if (!FUELS.includes(fuel)) {
      throw new CarModelFileError(`model "${key}" has fuel "${fuel}"`);
    }
  }
}

function refuseDuplicateKeys(models: readonly LicensedCarModel[]) {
  const keys = new Set<string>();
  for (const { key } of models) {
    if (keys.has(key)) throw new CarModelFileError(`duplicate key "${key}"`);
    keys.add(key);
  }
}

function refuseSharedRank(brand: string, own: readonly LicensedCarModel[]) {
  const byRank = new Map<number, string>();
  for (const { key, rank } of own) {
    const holder = byRank.get(rank);
    if (holder !== undefined) {
      throw new CarModelFileError(
        `brand "${brand}" ranks ${holder} and ${key} both ${rank}`,
      );
    }
    byRank.set(rank, key);
  }
}

function refuseRankGap(brand: string, own: readonly LicensedCarModel[]) {
  const ranks = own.map((m) => m.rank).sort((a, b) => a - b);
  if (ranks.some((rank, i) => rank !== i + 1)) {
    throw new CarModelFileError(
      `brand "${brand}" has ranks ${ranks.join(', ')}; they must be 1 to ${ranks.length}`,
    );
  }
}

export function carForBrand(
  brandKey: string,
  models: readonly LicensedCarModel[] = CAR_MODELS,
): CarForBrand {
  const model = models.find((m) => m.brand === brandKey && m.rank === 1);
  if (model) return { kind: 'licensed', model };
  const brand = BRANDS.find((b) => b.key === brandKey);
  return { bodyStyle: brand?.bodyStyle ?? 'saloon', kind: 'generic' };
}
