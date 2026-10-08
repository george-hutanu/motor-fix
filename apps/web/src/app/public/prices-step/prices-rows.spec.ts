import type { PriceEntry, PricesSection } from '@motor-fix/contracts';

import {
  addBrandRange,
  addJob,
  addProposal,
  brandOffer,
  canAdd,
  dropUntaken,
  PRE_LISTED,
  preList,
  remove,
  rows,
  setEnds,
} from './prices-rows';
import type { MarkedBrand } from '../brands-section';

// @traces 109-FR-004 109-FR-007 109-FR-008 109-FR-009

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const job = (key: string, n: number) => ({
  id: id(n),
  key,
  nameEn: key,
  nameRo: key,
});
const CATALOGUE = [
  job('ac-regas', 1),
  job('front-brakes', 2),
  job('diagnosis', 3),
  job('timing-chain', 4),
  job('oil-service', 5),
];
const DACIA = id(101);
const BMW = id(102);
const LADA = id(103);
const taken: MarkedBrand[] = [
  { brandId: DACIA, name: 'Dacia', stance: 'works_on' },
  { brandId: BMW, name: 'BMW', stance: 'works_on' },
  { brandId: LADA, name: 'Lada', stance: 'does_not_take' },
];

describe('preList', () => {
  it('lists diagnosis, oil service and front brakes, in that order, when the section has no job list', () => {
    expect(PRE_LISTED).toEqual(['diagnosis', 'oil-service', 'front-brakes']);
    expect(preList(undefined, CATALOGUE)).toEqual({
      jobs: [{ jobTypeId: id(3) }, { jobTypeId: id(5) }, { jobTypeId: id(2) }],
    });
    expect(preList({ labour: { fromBani: 10_000 } }, CATALOGUE)).toEqual({
      jobs: [{ jobTypeId: id(3) }, { jobTypeId: id(5) }, { jobTypeId: id(2) }],
      labour: { fromBani: 10_000 },
    });
  });

  it('leaves a section that already holds a job list, even an emptied one', () => {
    const kept: PricesSection = { jobs: [] };
    expect(preList(kept, CATALOGUE)).toBe(kept);
    const one: PricesSection = { jobs: [{ jobTypeId: id(4) }] };
    expect(preList(one, CATALOGUE)).toBe(one);
  });

  it('skips a pre-listed job the catalogue does not hold', () => {
    expect(preList(undefined, [job('diagnosis', 3)])).toEqual({
      jobs: [{ jobTypeId: id(3) }],
    });
  });
});

describe('adding rows', () => {
  it('adds a catalogue job once', () => {
    const once = addJob({}, CATALOGUE[0]);
    expect(once).toEqual({ jobs: [{ jobTypeId: id(1) }] });
    expect(addJob(once, CATALOGUE[0])).toBe(once);
  });

  it('adds a proposed job by its trimmed name, once whatever the case', () => {
    const once = addProposal({ jobs: [] }, '  Reglaj faruri ');
    expect(once).toEqual({ jobs: [{ name: 'Reglaj faruri' }] });
    expect(addProposal(once, 'REGLAJ FARURI')).toBe(once);
    const door = addProposal({ jobs: [] }, 'Vopsire ușă');
    expect(addProposal(door, 'vopsire usa')).toBe(door);
    expect(addProposal(once, '   ')).toBe(once);
  });

  it('counts only the rows without a brand toward the 50-job cap', () => {
    const jobs: PriceEntry[] = Array.from({ length: 49 }, (_, i) => ({
      jobTypeId: id(1000 + i),
    }));
    const almost = { jobs: [...jobs, { brandId: DACIA, jobTypeId: id(1000) }] };
    expect(canAdd(almost)).toBe(true);
    const full = addJob(almost, CATALOGUE[0]);
    expect(canAdd(full)).toBe(false);
    expect(addJob(full, CATALOGUE[1])).toBe(full);
    expect(addProposal(full, 'Reglaj faruri')).toBe(full);
  });

  it('puts a brand range right after its job and the job’s other brand ranges', () => {
    const section: PricesSection = {
      jobs: [{ jobTypeId: id(2) }, { name: 'Reglaj faruri' }],
    };
    const one = addBrandRange(section, 0, BMW);
    const two = addBrandRange(one, 0, DACIA);
    const proposed = addBrandRange(two, 3, BMW);

    expect(proposed.jobs).toEqual([
      { jobTypeId: id(2) },
      { brandId: BMW, jobTypeId: id(2) },
      { brandId: DACIA, jobTypeId: id(2) },
      { name: 'Reglaj faruri' },
      { brandId: BMW, name: 'Reglaj faruri' },
    ]);
    expect(addBrandRange(proposed, 0, BMW)).toBe(proposed);
  });
});

describe('the rows', () => {
  it('groups each job with its brand ranges, keeping each entry’s index', () => {
    const section: PricesSection = {
      jobs: [
        { jobTypeId: id(2) },
        { brandId: BMW, jobTypeId: id(2) },
        { name: 'Reglaj faruri' },
      ],
    };

    expect(rows(section)).toEqual([
      {
        brands: [{ entry: { brandId: BMW, jobTypeId: id(2) }, index: 1 }],
        entry: { jobTypeId: id(2) },
        index: 0,
      },
      { brands: [], entry: { name: 'Reglaj faruri' }, index: 2 },
    ]);
  });

  it('sets the two ends of one entry, dropping an emptied end', () => {
    const section: PricesSection = {
      jobs: [{ fromBani: 100, jobTypeId: id(2), toBani: 900 }],
    };

    expect(setEnds(section, 0, { fromBani: 15_000 }).jobs).toEqual([
      { fromBani: 15_000, jobTypeId: id(2), toBani: 900 },
    ]);
    expect(setEnds(section, 0, { toBani: undefined }).jobs).toEqual([
      { fromBani: 100, jobTypeId: id(2) },
    ]);
  });
});

describe('removing rows', () => {
  const section: PricesSection = {
    jobs: [
      { jobTypeId: id(2) },
      { brandId: BMW, jobTypeId: id(2) },
      { jobTypeId: id(3) },
    ],
  };

  it('removes a job with its brand ranges', () => {
    expect(remove(section, 0).jobs).toEqual([{ jobTypeId: id(3) }]);
  });

  it('removes one brand range alone', () => {
    expect(remove(section, 1).jobs).toEqual([
      { jobTypeId: id(2) },
      { jobTypeId: id(3) },
    ]);
  });

  it('can empty the list, which stays an empty list', () => {
    expect(remove({ jobs: [{ jobTypeId: id(2) }] }, 0)).toEqual({ jobs: [] });
  });
});

describe('the brands a range can be given for', () => {
  it('offers the brands step 2 takes that the job has no range for yet', () => {
    const section: PricesSection = {
      jobs: [{ jobTypeId: id(2) }, { brandId: BMW, jobTypeId: id(2) }],
    };

    expect(brandOffer(section, 0, taken)).toEqual([
      { brandId: DACIA, name: 'Dacia', stance: 'works_on' },
    ]);
    expect(brandOffer({ jobs: [{ jobTypeId: id(3) }] }, 0, taken)).toEqual(
      taken.slice(0, 2),
    );
  });

  it('drops the ranges of brands step 2 no longer takes, and keeps the section otherwise', () => {
    const section: PricesSection = {
      jobs: [
        { jobTypeId: id(2) },
        { brandId: BMW, jobTypeId: id(2) },
        { brandId: DACIA, jobTypeId: id(2) },
      ],
    };

    expect(dropUntaken(section, [DACIA]).jobs).toEqual([
      { jobTypeId: id(2) },
      { brandId: DACIA, jobTypeId: id(2) },
    ]);
    expect(dropUntaken(section, [DACIA, BMW])).toBe(section);
    expect(dropUntaken({}, [])).toEqual({});
  });
});
