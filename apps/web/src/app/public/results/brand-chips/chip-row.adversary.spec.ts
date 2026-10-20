import { type Chip, chipRow } from './chip-row';

const chip = (name: string, slug: string | undefined = name.toLowerCase()) =>
  slug === undefined
    ? { id: `id-${name}`, name }
    : { id: `id-${name}`, name, slug };
const many = (n: number, prefix = 'P') =>
  Array.from({ length: n }, (_, i) => chip(`${prefix}${i}`));
const names = (row: Chip[]) => row.map((c) => c.name);

// @traces 1355-results-brand-chips-FR-002
// @traces 1355-results-brand-chips-FR-003
describe('chipRow under hostile input', () => {
  it('caps a ten-thousand-brand popular list at 8', () => {
    const row = chipRow(chip('BMW'), [], many(10_000));

    expect(row).toHaveLength(8);
    expect(names(row)[0]).toBe('BMW');
  });

  it('caps ten thousand own brands at 8 and keeps the current one', () => {
    const row = chipRow(
      chip('Alfa'),
      many(10_000, 'Own').map((c) => ({ id: c.id, name: c.name })),
      many(8),
    );

    expect(row).toHaveLength(8);
    expect(names(row)).toContain('Alfa');
  });

  it('holds exactly 8 for exactly 8 popular brands without the current one among them', () => {
    expect(chipRow(chip('Alfa'), [], many(8))).toHaveLength(8);
    expect(names(chipRow(chip('Alfa'), [], many(8)))[0]).toBe('Alfa');
  });

  it('holds 8 when exactly 7 own brands and the current brand are given', () => {
    const own = many(7, 'Own').map((c) => ({ id: c.id, name: c.name }));

    const row = chipRow(chip('Alfa'), own, many(8));

    expect(names(row)).toEqual([...own.map((c) => c.name), 'Alfa']);
  });

  it('shows a brand repeated inside the popular list once', () => {
    const popular = [chip('BMW'), chip('BMW'), chip('Dacia'), chip('Dacia')];

    expect(names(chipRow(chip('Kia'), [], popular))).toEqual([
      'Kia',
      'BMW',
      'Dacia',
    ]);
  });

  it('shows the current brand once when it is also an own brand', () => {
    const row = chipRow(chip('Kia'), [chip('Kia', undefined)], many(3));

    expect(names(row).filter((n) => n === 'Kia')).toHaveLength(1);
    expect(names(row)[0]).toBe('Kia');
  });

  it('keeps an own brand in its place when it is the current brand', () => {
    const own = [chip('Kia', undefined), chip('Dacia', undefined)];

    expect(names(chipRow(chip('Dacia'), own, []))).toEqual(['Kia', 'Dacia']);
  });

  it('treats two brands with one name but different ids as two chips', () => {
    const a = { id: 'a', name: 'Same', slug: 'same' };
    const b = { id: 'b', name: 'Same', slug: 'same-2' };

    expect(chipRow(a, [], [b]).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('returns the own brands alone when the popular list is empty and there is no current brand', () => {
    expect(names(chipRow(undefined, [chip('Kia', undefined)], []))).toEqual([
      'Kia',
    ]);
  });

  it('keeps unicode names intact', () => {
    const row = chipRow(
      chip('Škoda', 'skoda'),
      [],
      [chip('Citroën', 'citroen')],
    );

    expect(names(row)).toEqual(['Škoda', 'Citroën']);
  });

  it('does not change the lists it is given', () => {
    const own = [chip('Kia', undefined)];
    const popular = many(10);
    const ownCopy = JSON.parse(JSON.stringify(own));
    const popularCopy = JSON.parse(JSON.stringify(popular));

    chipRow(chip('Alfa'), own, popular);

    expect(own).toEqual(ownCopy);
    expect(popular).toEqual(popularCopy);
  });

  it('answers the same twice for the same input', () => {
    const own = [chip('Kia', undefined)];
    const popular = many(10);

    expect(chipRow(chip('Alfa'), own, popular)).toEqual(
      chipRow(chip('Alfa'), own, popular),
    );
  });

  it('returns a new array that is not the popular list itself', () => {
    const popular = many(3);

    expect(chipRow(undefined, [], popular)).not.toBe(popular);
  });
});
