import { type Chip, chipRow } from './chip-row';

const chip = (name: string, slug: string | undefined = name.toLowerCase()) =>
  slug === undefined
    ? { id: `id-${name}`, name }
    : { id: `id-${name}`, name, slug };
const POPULAR = [
  'BMW',
  'Volkswagen',
  'Dacia',
  'Toyota',
  'Mercedes',
  'Skoda',
  'Ford',
  'Tesla',
].map((name) => chip(name));
const names = (row: Chip[]) => row.map((c) => c.name);

// @traces 1355-results-brand-chips-FR-002
// @traces 1355-results-brand-chips-FR-003
describe('chipRow', () => {
  it('shows a visitor the popular brands, the current one among them where it stands', () => {
    expect(names(chipRow(chip('BMW'), [], POPULAR))).toEqual([
      'BMW',
      'Volkswagen',
      'Dacia',
      'Toyota',
      'Mercedes',
      'Skoda',
      'Ford',
      'Tesla',
    ]);
  });

  it('puts a current brand that is not popular first for a visitor and keeps the row at 8', () => {
    expect(names(chipRow(chip('Alfa'), [], POPULAR))).toEqual([
      'Alfa',
      'BMW',
      'Volkswagen',
      'Dacia',
      'Toyota',
      'Mercedes',
      'Skoda',
      'Ford',
    ]);
  });

  it("leads with the driver's own brands, then the current one, then the popular ones, each once", () => {
    const own = [chip('Kia', undefined), chip('Dacia', undefined)];

    expect(names(chipRow(chip('Alfa'), own, POPULAR))).toEqual([
      'Kia',
      'Dacia',
      'Alfa',
      'BMW',
      'Volkswagen',
      'Toyota',
      'Mercedes',
      'Skoda',
    ]);
  });

  it('shows a brand of two cars once', () => {
    const own = [chip('Kia', undefined), chip('Kia', undefined)];

    expect(names(chipRow(chip('BMW'), own, POPULAR)).slice(0, 3)).toEqual([
      'Kia',
      'BMW',
      'Volkswagen',
    ]);
  });

  it('gives an own brand the slug of the same popular brand', () => {
    const row = chipRow(chip('BMW'), [chip('Dacia', undefined)], POPULAR);

    expect(row[0]).toEqual({ id: 'id-Dacia', name: 'Dacia', slug: 'dacia' });
  });

  it('lets the own brands fill the row, the current one kept', () => {
    const own = Array.from({ length: 9 }, (_, i) => chip(`Own${i}`, undefined));

    const row = chipRow(chip('Alfa'), own, POPULAR);

    expect(row).toHaveLength(8);
    expect(names(row)).toContain('Alfa');
    expect(names(row)).not.toContain('BMW');
  });

  it('shows what it has when the lists are short, never a blank chip', () => {
    expect(names(chipRow(chip('BMW'), [], POPULAR.slice(0, 3)))).toEqual([
      'BMW',
      'Volkswagen',
      'Dacia',
    ]);
    expect(names(chipRow(chip('BMW'), [], []))).toEqual(['BMW']);
    expect(chipRow(undefined, [], [])).toEqual([]);
    expect(names(chipRow(undefined, [], POPULAR.slice(0, 2)))).toEqual([
      'BMW',
      'Volkswagen',
    ]);
  });
});
