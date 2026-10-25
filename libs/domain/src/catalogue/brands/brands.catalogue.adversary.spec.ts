import { BRANDS, slugOf, validateFile } from './brands';
import { JOB_TYPES } from '../job-types/job-types';

const MOCK_ORDER = [
  'BMW',
  'Mini',
  'Mercedes-Benz',
  'Audi',
  'Volkswagen',
  'Škoda',
  'Dacia',
  'Renault',
  'Ford',
  'Toyota',
  'Hyundai',
  'Tesla',
];

describe('the full brand file', () => {
  it('passes the file checks as shipped', () => {
    expect(() => validateFile(BRANDS)).not.toThrow(Error);
  });

  it('names every brand the requirements list by name', () => {
    const names = BRANDS.map((b) => b.name);
    for (const required of [
      'Škoda',
      'Mercedes-Benz',
      'Citroën',
      'Alfa Romeo',
      'Land Rover',
      'Lada',
      'Chevrolet',
      'Daewoo',
      'Saab',
      'Rover',
      'Infiniti',
      'ARO',
      'Chrysler',
      'Dodge',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('keeps each key equal to the slug of its name', () => {
    const off = BRANDS.filter((b) => b.key !== slugOf(b.name)).map(
      (b) => b.key,
    );
    expect(off).toEqual([]);
  });

  it('gives every brand a whole-number rank, none shared', () => {
    const ranks = BRANDS.map((b) => b.popularity);
    expect(
      ranks.filter((r) => !Number.isInteger(r) || (r as number) < 1),
    ).toEqual([]);
    expect(new Set(ranks).size).toBe(BRANDS.length);
  });

  it('holds the mock twelve at ranks 1 to 12 in the mock order', () => {
    const top = [...BRANDS]
      .sort((a, b) => (a.popularity ?? 0) - (b.popularity ?? 0))
      .slice(0, 12);
    expect(top.map((b) => [b.name, b.popularity])).toEqual(
      MOCK_ORDER.map((n, i) => [n, i + 1]),
    );
  });

  it('ranks every other brand from 13 upward', () => {
    const rest = BRANDS.filter((b) => !MOCK_ORDER.includes(b.name));
    expect(Math.min(...rest.map((b) => b.popularity as number))).toBe(13);
  });

  it('keeps the fifteen shipped keys and names', () => {
    const byKey = Object.fromEntries(BRANDS.map((b) => [b.key, b.name]));
    expect(byKey).toMatchObject({
      'alfa-romeo': 'Alfa Romeo',
      audi: 'Audi',
      bmw: 'BMW',
      citroen: 'Citroën',
      dacia: 'Dacia',
      ford: 'Ford',
      hyundai: 'Hyundai',
      'mercedes-benz': 'Mercedes-Benz',
      mini: 'Mini',
      opel: 'Opel',
      renault: 'Renault',
      skoda: 'Škoda',
      tesla: 'Tesla',
      toyota: 'Toyota',
      volkswagen: 'Volkswagen',
    });
  });

  it('has no name with stray spaces and no two names that differ only in case', () => {
    expect(
      BRANDS.filter((b) => b.name !== b.name.trim().replace(/\s+/g, ' ')),
    ).toEqual([]);
    expect(new Set(BRANDS.map((b) => b.name.toLowerCase())).size).toBe(
      BRANDS.length,
    );
  });

  it('gives a name ending in a lowercase a the form "<Name> ta"', () => {
    const bad = BRANDS.filter(
      (b) =>
        b.name !== b.name.toUpperCase() &&
        /a$/.test(b.name) &&
        b.roPossessive !== `${b.name} ta`,
    ).map((b) => `${b.name}: ${b.roPossessive}`);
    expect(bad).toEqual([]);
  });

  it('gives an all-capitals name the form "<Name>‑ul tău"', () => {
    const bad = BRANDS.filter(
      (b) =>
        /[A-Z]/.test(b.name) &&
        b.name === b.name.toUpperCase() &&
        b.roPossessive !== `${b.name}‑ul tău`,
    ).map((b) => `${b.name}: ${b.roPossessive}`);
    expect(bad).toEqual([]);
  });

  it('starts every new brand your form with its name, hyphens non-breaking', () => {
    const bad = BRANDS.filter(
      (b) =>
        !MOCK_ORDER.includes(b.name) &&
        !b.roPossessive?.startsWith(b.name.replace(/-/g, '\u2011')),
    ).map((b) => b.name);
    expect(bad).toEqual([]);
  });

  it('holds no model and no body style that the file does not know', () => {
    const allowed = [
      'saloon',
      'hatchback',
      'suv',
      'crossover',
      'estate',
      'fastback',
    ];
    const bad = BRANDS.filter(
      (b) => b.bodyStyle !== undefined && !allowed.includes(b.bodyStyle),
    );
    expect(bad).toEqual([]);
  });
});

describe('the launch job file', () => {
  it('holds exactly the six launch keys, each with both names', () => {
    expect(JOB_TYPES.map((j) => j.key).sort()).toEqual([
      'ac-regas',
      'diagnosis',
      'front-brakes',
      'oil-service',
      'suspension-alignment',
      'timing-chain',
    ]);
    expect(
      JOB_TYPES.filter((j) => !j.nameRo.trim() || !j.nameEn.trim()),
    ).toEqual([]);
  });
});
