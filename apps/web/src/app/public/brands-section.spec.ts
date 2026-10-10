import {
  brandsOf,
  dropUnlisted,
  fuelsOf,
  jobsOf,
  type MarkedBrand,
  mark,
  refOf,
  tickAll,
  toggleFuel,
  toggleJob,
  untickedOf,
} from './brands-section';

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

describe('step 2 as the draft holds it', () => {
  const ID = '2f1c6a0e-8b1d-4c3a-9e57-0d6f1b2c3a4d';
  const draft = (section: unknown) => ({ steps: { 2: section } });

  it('opens with the brands of a section in shape', () => {
    const brands = [
      { brandId: ID, fuels: ['diesel'], name: 'Dacia', stance: 'works_on' },
    ];

    expect(brandsOf(draft({ brandNote: 'Doar Dacia', brands }))).toEqual({
      brandNote: 'Doar Dacia',
      brands,
    });
  });

  it('opens with nothing marked when a brand id is not a uuid', () => {
    const brands = [{ brandId: 'b-dacia', name: 'Dacia', stance: 'works_on' }];

    expect(brandsOf(draft({ brands }))).toEqual({ brands: [] });
  });

  it('opens with nothing marked when a brand is marked twice', () => {
    const dacia = { brandId: ID, name: 'Dacia', stance: 'works_on' };

    expect(brandsOf(draft({ brands: [dacia, dacia] }))).toEqual({
      brands: [],
    });
  });

  it('opens with nothing marked when the section carries an unknown key', () => {
    expect(brandsOf(draft({ brands: [], extra: 1 }))).toEqual({ brands: [] });
  });
});

describe("a taken brand's jobs", () => {
  const OIL = '1c6a9e2b-3d4f-4a5b-8c7d-9e0f1a2b3c4d';
  const BRAKES = '2d7b0f3c-4e5a-4b6c-9d8e-0f1a2b3c4d5e';
  const withOff = (
    brand: { id: string; name: string },
    unticked: string[],
  ): MarkedBrand => ({ ...taken(brand), unticked });

  // @traces 412-FR-001
  it('lists the distinct jobs of the price list in its order, brand ranges folded into their job', () => {
    expect(
      jobsOf([
        { fromBani: 100, jobTypeId: OIL, toBani: 200 },
        { brandId: DACIA.id, fromBani: 300, jobTypeId: OIL },
        { name: 'Reglaj faruri' },
        { brandId: BMW.id, name: 'Reglaj faruri' },
        { jobTypeId: BRAKES },
      ]),
    ).toEqual([
      { jobTypeId: OIL },
      { name: 'Reglaj faruri' },
      { jobTypeId: BRAKES },
    ]);
  });

  // @traces 412-FR-003
  it('names a catalogue job by its id and a proposed job by its name', () => {
    expect(refOf({ jobTypeId: OIL })).toBe(OIL);
    expect(refOf({ name: 'Reglaj faruri' })).toBe('Reglaj faruri');
  });

  // @traces 412-FR-002 412-FR-003
  it('has nothing unticked on a brand just taken, or kept from before job ticks', () => {
    expect(untickedOf(mark([], DACIA, 'works_on')[0])).toEqual([]);
    expect(untickedOf(taken(DACIA))).toEqual([]);
  });

  // @traces 412-FR-002
  it('records a job unticked, and removes the record when it is ticked back', () => {
    const off = toggleJob([taken(DACIA)], DACIA.id, OIL);
    expect(off).toEqual([withOff(DACIA, [OIL])]);

    expect(toggleJob(off, DACIA.id, OIL)).toEqual([taken(DACIA)]);
  });

  // @traces 412-FR-002
  it('records a proposed job by its name', () => {
    expect(toggleJob([taken(DACIA)], DACIA.id, 'Reglaj faruri')).toEqual([
      withOff(DACIA, ['Reglaj faruri']),
    ]);
  });

  // @traces 412-FR-002
  it('leaves the other brands as they are', () => {
    const bmw = taken(BMW);

    expect(toggleJob([taken(DACIA), bmw], DACIA.id, OIL)[1]).toBe(bmw);
  });

  // @traces 412-FR-002
  it('ticks every job back, leaving no record', () => {
    expect(tickAll([withOff(DACIA, [OIL, BRAKES])], DACIA.id)).toEqual([
      taken(DACIA),
    ]);
  });

  // @traces 412-FR-001
  it('changes nothing when every job is already ticked', () => {
    const brands = [taken(DACIA)];

    expect(tickAll(brands, DACIA.id)).toBe(brands);
  });

  // @traces 412-FR-002
  it('drops the records of a brand refused or switched off, and starts all ticked when taken again', () => {
    const refused = mark([withOff(DACIA, [OIL])], DACIA, 'does_not_take');
    expect(refused).toEqual([
      { brandId: DACIA.id, name: 'Dacia', stance: 'does_not_take' },
    ]);

    const back = mark(mark(refused, DACIA, undefined), DACIA, 'works_on');
    expect(untickedOf(back[0])).toEqual([]);
  });

  // @traces 412-FR-002
  it('keeps the records of a brand marked taken again in place', () => {
    expect(mark([withOff(DACIA, [OIL])], DACIA, 'works_on')).toEqual([
      withOff(DACIA, [OIL]),
    ]);
  });

  // @traces 412-FR-002
  it('drops, on every brand, the records of a job no longer on the price list', () => {
    const brands = [
      withOff(DACIA, [OIL, 'Reglaj faruri']),
      withOff(BMW, ['Reglaj faruri']),
    ];

    expect(dropUnlisted(brands, [OIL, 'Reglaj far'])).toEqual([
      withOff(DACIA, [OIL]),
      taken(BMW),
    ]);
  });

  // @traces 412-FR-002
  it('gives back the same list when every record still names a job', () => {
    const brands = [withOff(DACIA, [OIL]), taken(BMW)];

    expect(dropUnlisted(brands, [OIL, BRAKES])).toBe(brands);
  });

  // @traces 412-FR-003
  it('opens a kept section with its unticked jobs', () => {
    const ID = '2f1c6a0e-8b1d-4c3a-9e57-0d6f1b2c3a4d';
    const brands = [
      { brandId: ID, name: 'Dacia', stance: 'works_on', unticked: [OIL] },
    ];

    expect(brandsOf({ steps: { 2: { brands } } })).toEqual({ brands });
  });
});
