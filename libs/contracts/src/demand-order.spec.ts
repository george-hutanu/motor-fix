import { orderBrands } from './demand-order';

// @traces 404-demand-searches-FR-009

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
