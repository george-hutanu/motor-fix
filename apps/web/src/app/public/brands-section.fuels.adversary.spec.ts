import { FUELS } from '@motor-fix/contracts/marked-brands';

import {
  brandsOf,
  fuelsOf,
  type MarkedBrand,
  mark,
  toggleFuel,
} from './brands-section';

const ID = '3f2b8c1e-5a47-4d0b-9c1a-0d6f2e7a9b11';
const ID2 = '4f2b8c1e-5a47-4d0b-9c1a-0d6f2e7a9b12';
const dacia = { id: ID, name: 'Dacia' };
const draft = (section: unknown) => ({ steps: { '2': section } });
const taken = (fuels?: MarkedBrand['fuels']): MarkedBrand => ({
  brandId: ID,
  name: 'Dacia',
  stance: 'works_on',
  ...(fuels ? { fuels } : {}),
});

describe('fuel ticks of a taken brand', () => {
  it('reads a brand without fuels as all four ticked and an empty list as none', () => {
    expect(fuelsOf(taken())).toEqual([...FUELS]);
    expect(fuelsOf(taken([]))).toEqual([]);
  });

  it('does not hand out the stored array to be mutated', () => {
    const held = taken(['petrol']);
    fuelsOf(held).push('diesel');
    expect(held.fuels).toEqual(['petrol']);
  });

  it('unticks one fuel from the implicit four and keeps the fixed order', () => {
    const [dacia1] = toggleFuel([taken()], ID, 'diesel');
    expect(dacia1.fuels).toEqual(['petrol', 'hybrid', 'electric']);
  });

  it('writes an empty list, not an absent key, once the last fuel is unticked', () => {
    let list = [taken(['electric'])];
    list = toggleFuel(list, ID, 'electric');
    expect(list[0].fuels).toEqual([]);
    expect('fuels' in list[0]).toBe(true);
  });

  it('ticks a fuel back from an empty list in the fixed order', () => {
    let list = [taken([])];
    list = toggleFuel(list, ID, 'electric');
    list = toggleFuel(list, ID, 'petrol');
    expect(list[0].fuels).toEqual(['petrol', 'electric']);
  });

  it('toggling twice returns to the same fuels', () => {
    const start = [taken(['petrol', 'hybrid'])];
    const twice = toggleFuel(toggleFuel(start, ID, 'diesel'), ID, 'diesel');
    expect(twice[0].fuels).toEqual(['petrol', 'hybrid']);
  });

  it('leaves other brands and the input list untouched', () => {
    const other: MarkedBrand = { ...taken(), brandId: ID2, name: 'BMW' };
    const input = [taken(), other];
    const out = toggleFuel(input, ID, 'petrol');
    expect(out[1]).toBe(other);
    expect(input[0].fuels).toBeUndefined();
  });

  it('does nothing for a brand id that is not in the list', () => {
    expect(toggleFuel([taken()], ID2, 'petrol')).toEqual([taken()]);
  });
});

describe('marking a brand keeps or drops its fuels', () => {
  it('starts a newly taken brand with no fuels key, meaning all four', () => {
    const [added] = mark([], dacia, 'works_on');
    expect(added).toEqual({ brandId: ID, name: 'Dacia', stance: 'works_on' });
  });

  it('drops the fuels when the brand is refused, and does not bring them back when taken again', () => {
    const refused = mark([taken(['petrol'])], dacia, 'does_not_take');
    expect(refused[0]).toEqual({
      brandId: ID,
      name: 'Dacia',
      stance: 'does_not_take',
    });
    const again = mark(refused, dacia, 'works_on');
    expect(again[0].fuels).toBeUndefined();
    expect(fuelsOf(again[0])).toEqual([...FUELS]);
  });

  it('removes the brand and its fuels when it is switched off, and the same call twice changes nothing more', () => {
    const off = mark([taken([])], dacia, undefined);
    expect(off).toEqual([]);
    expect(mark(off, dacia, undefined)).toEqual([]);
  });

  it('keeps an empty fuels list when the same taken stance is applied again', () => {
    const [same] = mark([taken([])], dacia, 'works_on');
    expect(same.fuels).toEqual([]);
  });
});

describe('opening a draft saved with fuels', () => {
  it('keeps an empty list as none ticked', () => {
    const { brands } = brandsOf(draft({ brands: [taken([])] }));
    expect(fuelsOf(brands[0])).toEqual([]);
  });

  it('opens a draft from before fuels with every taken brand fully ticked', () => {
    const { brands } = brandsOf(draft({ brands: [taken()] }));
    expect(fuelsOf(brands[0])).toEqual([...FUELS]);
  });

  it.each([
    ['an unknown kind', { brands: [taken(['lpg' as never])] }],
    ['a duplicate kind', { brands: [taken(['petrol', 'petrol'])] }],
    [
      'fuels on a refused brand',
      { brands: [{ ...taken([]), stance: 'does_not_take' }] },
    ],
    ['fuels as null', { brands: [{ ...taken(), fuels: null }] }],
  ])('opens with nothing marked for a copy with %s', (_label, section) => {
    expect(brandsOf(draft(section))).toEqual({ brands: [] });
  });
});
