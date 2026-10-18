import { orderBrands } from './demand-order';

// @traces 404-FR-009

const row = (name: string, searches: number, requests: number) => ({
  name,
  requests,
  searches,
});

describe('the order of the demand brands', () => {
  const brands = [
    row('Renault', 0, 9),
    row('BMW', 4, 1),
    row('Opel', 4, 3),
    row('Dacia', 7, 2),
  ];

  it('puts the most searched first, then the most requested', () => {
    expect(orderBrands(brands, 'searches').map((b) => b.name)).toEqual([
      'Dacia',
      'Opel',
      'BMW',
      'Renault',
    ]);
  });

  it('puts the most requested first, then the most searched', () => {
    expect(orderBrands(brands, 'requests').map((b) => b.name)).toEqual([
      'Renault',
      'Opel',
      'Dacia',
      'BMW',
    ]);
  });

  it('orders brands tied on both figures by name, capitals first', () => {
    const tied = [row('audi', 1, 1), row('BMW', 1, 1), row('Audi', 1, 1)];

    for (const by of ['searches', 'requests'] as const)
      expect(orderBrands(tied, by).map((b) => b.name)).toEqual([
        'Audi',
        'BMW',
        'audi',
      ]);
  });

  it('orders names by code point, not by UTF-16 unit', () => {
    const tied = [row('😀', 1, 1), row('ﬁ', 1, 1)];

    expect(orderBrands(tied, 'searches').map((b) => b.name)).toEqual([
      'ﬁ',
      '😀',
    ]);
  });

  it('leaves the list it was given as it was', () => {
    const copy = [...brands];

    orderBrands(brands, 'searches');

    expect(brands).toEqual(copy);
  });
});

describe('the order of the demand brands at the edges', () => {
  it('returns an empty list for no brands', () => {
    expect(orderBrands([], 'searches')).toEqual([]);
    expect(orderBrands([], 'requests')).toEqual([]);
  });

  it('returns a new list holding the one brand of a single-brand list', () => {
    const one = [row('Dacia', 1, 1)];

    const out = orderBrands(one, 'requests');

    expect(out).toEqual(one);
    expect(out).not.toBe(one);
  });

  it('orders ten thousand brands without losing or repeating one', () => {
    const many = Array.from({ length: 10000 }, (_, i) =>
      row(`B${i}`, i % 7, (i * 31) % 11),
    );

    const out = orderBrands(many, 'searches');

    expect(new Set(out.map((b) => b.name)).size).toBe(10000);
    for (let i = 1; i < out.length; i++)
      expect(out[i - 1].searches).toBeGreaterThanOrEqual(out[i].searches);
  });

  it('is idempotent and gives the same order whatever order it was handed', () => {
    const list = [
      row('B', 2, 2),
      row('A', 2, 2),
      row('C', 5, 0),
      row('D', 0, 5),
    ];

    for (const by of ['searches', 'requests'] as const) {
      const once = orderBrands(list, by);
      expect(orderBrands(once, by)).toEqual(once);
      expect(orderBrands([...list].reverse(), by)).toEqual(once);
    }
  });

  it('keeps extra fields on each brand', () => {
    const out = orderBrands([{ ...row('A', 1, 1), id: 7 }], 'searches');

    expect(out).toEqual([{ id: 7, name: 'A', requests: 1, searches: 1 }]);
  });

  it('orders names by code point for Latin-1 accents and the empty name', () => {
    const tied = [row('Škoda', 1, 1), row('Zeta', 1, 1), row('', 1, 1)];

    expect(orderBrands(tied, 'searches').map((b) => b.name)).toEqual([
      '',
      'Zeta',
      'Škoda',
    ]);
  });
});
