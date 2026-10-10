import {
  brandsOf,
  dropUnlisted,
  jobsOf,
  type MarkedBrand,
  mark,
  refOf,
  tickAll,
  toggleJob,
  untickedOf,
} from './brands-section';

const DACIA = '3f2b8c1e-5a47-4d0b-9c1a-0d6f2e7a9b11';
const BMW = '4f2b8c1e-5a47-4d0b-9c1a-0d6f2e7a9b12';
const OIL = '5f2b8c1e-5a47-4d0b-9c1a-0d6f2e7a9b13';
const BRAKES = '6f2b8c1e-5a47-4d0b-9c1a-0d6f2e7a9b14';

const taken = (id = DACIA, extra: Partial<MarkedBrand> = {}): MarkedBrand => ({
  brandId: id,
  name: id === DACIA ? 'Dacia' : 'BMW',
  stance: 'works_on',
  ...extra,
});

describe('unticking jobs of a taken brand', () => {
  it('toggling a job twice restores a brand with no unticked key at all', () => {
    const start = [taken()];
    const twice = toggleJob(toggleJob(start, DACIA, OIL), DACIA, OIL);
    expect(twice).toEqual([taken()]);
    expect('unticked' in twice[0]).toBe(false);
  });

  it('records one job once however often it is unticked and ticked', () => {
    let list = [taken()];
    list = toggleJob(list, DACIA, OIL);
    list = toggleJob(list, DACIA, BRAKES);
    list = toggleJob(list, DACIA, OIL);
    expect(untickedOf(list[0])).toEqual([BRAKES]);
    list = toggleJob(list, DACIA, OIL);
    expect(untickedOf(list[0])).toEqual([BRAKES, OIL]);
  });

  it('touches only the named brand and never the input list', () => {
    const start = [taken(DACIA), taken(BMW)];
    const frozen = JSON.stringify(start);
    const out = toggleJob(start, DACIA, OIL);
    expect(JSON.stringify(start)).toBe(frozen);
    expect(out[1]).toBe(start[1]);
    expect(untickedOf(out[1])).toEqual([]);
  });

  it('leaves the list as it was for a brand that is not in it', () => {
    expect(toggleJob([taken()], BMW, OIL)).toEqual([taken()]);
    expect(toggleJob([], BMW, OIL)).toEqual([]);
  });

  it('keeps fuels beside the unticked jobs', () => {
    const out = toggleJob([taken(DACIA, { fuels: ['diesel'] })], DACIA, OIL);
    expect(out[0]).toEqual(
      taken(DACIA, { fuels: ['diesel'], unticked: [OIL] }),
    );
  });

  it('does not hand out the stored unticked array to be mutated', () => {
    const held = taken(DACIA, { unticked: [OIL] });
    untickedOf(held).push(BRAKES);
    expect(held.unticked).toEqual([OIL]);
  });

  it('ticks all by removing the key, and hands back the same list when nothing is unticked', () => {
    const list = [taken(DACIA, { unticked: [OIL, BRAKES] })];
    const out = tickAll(list, DACIA);
    expect('unticked' in out[0]).toBe(false);
    const fresh = [taken()];
    expect(tickAll(fresh, DACIA)).toBe(fresh);
    expect(tickAll(fresh, BMW)).toBe(fresh);
  });

  it('keeps a name that differs only by case as a second job', () => {
    let list = [taken()];
    list = toggleJob(list, DACIA, 'Reglaj faruri');
    list = toggleJob(list, DACIA, 'reglaj faruri');
    expect(untickedOf(list[0])).toEqual(['Reglaj faruri', 'reglaj faruri']);
  });
});

describe('the unticked record when the price list or the stance changes', () => {
  it('drops every ref that left the price list, on every brand, and the key when none is left', () => {
    const list = [
      taken(DACIA, { unticked: [OIL, 'Reglaj faruri'] }),
      taken(BMW, { unticked: ['Reglaj faruri'] }),
    ];
    const out = dropUnlisted(list, [OIL]);
    expect(out[0].unticked).toEqual([OIL]);
    expect('unticked' in out[1]).toBe(false);
  });

  it('drops everything when the price list is empty', () => {
    const out = dropUnlisted([taken(DACIA, { unticked: [OIL] })], []);
    expect('unticked' in out[0]).toBe(false);
  });

  it('returns the same list when every ref is still listed', () => {
    const list = [taken(DACIA, { unticked: [OIL] }), taken(BMW)];
    expect(dropUnlisted(list, [OIL, BRAKES])).toBe(list);
  });

  it('treats a renamed proposed job as a different job', () => {
    const out = dropUnlisted(
      [taken(DACIA, { unticked: ['Reglaj faruri'] })],
      ['Reglaj far'],
    );
    expect('unticked' in out[0]).toBe(false);
  });

  it('loses the record when the brand goes to refused and starts ticked when taken again', () => {
    const dacia = { id: DACIA, name: 'Dacia' };
    let list = [taken(DACIA, { unticked: [OIL] })];
    list = mark(list, dacia, 'does_not_take');
    expect(list[0]).toEqual({
      brandId: DACIA,
      name: 'Dacia',
      stance: 'does_not_take',
    });
    list = mark(list, dacia, undefined);
    list = mark(list, dacia, 'works_on');
    expect('unticked' in list[0]).toBe(false);
  });

  it('loses the record on refused then taken without passing through off', () => {
    const dacia = { id: DACIA, name: 'Dacia' };
    let list = [taken(DACIA, { unticked: [OIL] })];
    list = mark(list, dacia, 'does_not_take');
    list = mark(list, dacia, 'works_on');
    expect('unticked' in list[0]).toBe(false);
  });
});

describe("reading the price list's jobs", () => {
  it('is empty for an empty price list', () => {
    expect(jobsOf([])).toEqual([]);
  });

  it('lists a job priced for several brands once, in the order first met', () => {
    const jobs = jobsOf([
      { fromBani: 1, jobTypeId: OIL },
      { fromBani: 1, name: 'Reglaj faruri' },
      { brandId: BMW, fromBani: 1, jobTypeId: OIL },
      { fromBani: 1, jobTypeId: BRAKES },
      { brandId: DACIA, fromBani: 1, name: 'Reglaj faruri' },
    ] as never);
    expect(jobs.map(refOf)).toEqual([OIL, 'Reglaj faruri', BRAKES]);
  });

  it('does not carry the per-brand range into the job', () => {
    const [job] = jobsOf([
      { brandId: BMW, fromBani: 9, jobTypeId: OIL, toBani: 99 },
    ] as never);
    expect(job).toEqual({ jobTypeId: OIL });
  });

  it('refs a catalogue job by its id and a proposed one by its name', () => {
    expect(refOf({ jobTypeId: OIL })).toBe(OIL);
    expect(refOf({ name: 'Reglaj faruri' })).toBe('Reglaj faruri');
  });
});

describe('a kept draft read for the form', () => {
  const draft = (brands: unknown) => ({ steps: { '2': { brands } } });

  it('reads a brand with no unticked key as every job ticked', () => {
    expect(untickedOf(brandsOf(draft([taken()])).brands[0])).toEqual([]);
  });

  it('opens with nothing marked when a refused brand carries unticked jobs', () => {
    const bad = { ...taken(), stance: 'does_not_take', unticked: [OIL] };
    expect(brandsOf(draft([bad]))).toEqual({ brands: [] });
  });

  it('opens with nothing marked when unticked holds the same job twice', () => {
    const bad = taken(DACIA, { unticked: [OIL, OIL] });
    expect(brandsOf(draft([bad]))).toEqual({ brands: [] });
  });
});
