import { fuelsOf, type MarkedBrand, mark, toggleFuel } from './brands-section';

const DACIA = { id: 'b-dacia', name: 'Dacia' };
const BMW = { id: 'b-bmw', name: 'BMW' };
const taken = (
  brand: { id: string; name: string },
  fuels?: MarkedBrand['fuels'],
): MarkedBrand => ({
  brandId: brand.id,
  name: brand.name,
  stance: 'works_on',
  ...(fuels && { fuels }),
});

describe("a taken brand's fuels", () => {
  it('are all four when the brand holds no fuels', () => {
    expect(fuelsOf(taken(DACIA))).toEqual([
      'petrol',
      'diesel',
      'hybrid',
      'electric',
    ]);
  });

  it('are none when the brand holds an empty list', () => {
    expect(fuelsOf(taken(DACIA, []))).toEqual([]);
  });

  it('are the ones the brand holds', () => {
    expect(fuelsOf(taken(DACIA, ['diesel', 'petrol']))).toEqual([
      'diesel',
      'petrol',
    ]);
  });

  it('unticks one fuel of a brand holding none, leaving the other three in order', () => {
    expect(toggleFuel([taken(DACIA)], DACIA.id, 'electric')).toEqual([
      taken(DACIA, ['petrol', 'diesel', 'hybrid']),
    ]);
  });

  it('ticks a fuel back in the fixed order', () => {
    expect(toggleFuel([taken(DACIA, ['hybrid'])], DACIA.id, 'petrol')).toEqual([
      taken(DACIA, ['petrol', 'hybrid']),
    ]);
  });

  it('keeps an empty list once the last fuel is unticked', () => {
    expect(toggleFuel([taken(DACIA, ['diesel'])], DACIA.id, 'diesel')).toEqual([
      taken(DACIA, []),
    ]);
  });

  it('leaves the other brands as they are', () => {
    const bmw = taken(BMW, ['petrol']);

    expect(toggleFuel([taken(DACIA), bmw], DACIA.id, 'diesel')[1]).toBe(bmw);
  });
});

describe('marking a brand with fuels', () => {
  it('drops the fuels when the brand is refused, and starts at all four when taken again', () => {
    const refused = mark([taken(DACIA, ['petrol'])], DACIA, 'does_not_take');
    expect(refused).toEqual([
      { brandId: DACIA.id, name: 'Dacia', stance: 'does_not_take' },
    ]);

    const back = mark(mark(refused, DACIA, undefined), DACIA, 'works_on');

    expect(back).toEqual([taken(DACIA)]);
    expect(fuelsOf(back[0])).toHaveLength(4);
  });

  it('keeps the fuels of a brand marked taken again in place', () => {
    expect(mark([taken(DACIA, ['diesel'])], DACIA, 'works_on')).toEqual([
      taken(DACIA, ['diesel']),
    ]);
  });
});
