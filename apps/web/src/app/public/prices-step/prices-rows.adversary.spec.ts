import { JOBS_MAX, type PricesSection } from '@motor-fix/contracts';

import {
  addBrandRange,
  addJob,
  addProposal,
  brandOffer,
  canAdd,
  dropUntaken,
  preList,
  remove,
  rows,
  setEnds,
} from './prices-rows';
import type { MarkedBrand } from '../brands-section';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const jobs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ jobTypeId: id(i + 1) }));
const DACIA = id(901);
const BMW = id(902);

describe('preList with an odd catalogue', () => {
  it('lists nothing when the catalogue is empty, and still gives a job list', () => {
    expect(preList(undefined, [])).toEqual({ jobs: [] });
  });

  it('lists only the pre-listed jobs the catalogue has', () => {
    expect(preList(undefined, [{ id: id(5), key: 'oil-service' }])).toEqual({
      jobs: [{ jobTypeId: id(5) }],
    });
  });

  it('ignores catalogue jobs whose key is not one of the three', () => {
    expect(preList(undefined, [{ id: id(1), key: 'ac-regas' }])).toEqual({
      jobs: [],
    });
  });

  it('does not match a key by prefix or case', () => {
    expect(
      preList(undefined, [
        { id: id(1), key: 'Diagnosis' },
        { id: id(2), key: 'diagnosis-extra' },
      ]),
    ).toEqual({ jobs: [] });
  });

  it('keeps the section it was given when it already holds a job list', () => {
    const given: PricesSection = { jobs: [] };
    expect(preList(given, [{ id: id(3), key: 'diagnosis' }])).toBe(given);
  });

  it('gives the same answer when called twice with the result', () => {
    const once = preList(undefined, [{ id: id(3), key: 'diagnosis' }]);
    expect(preList(once, [{ id: id(3), key: 'diagnosis' }])).toBe(once);
  });

  it('does not change the section it was given', () => {
    const given: PricesSection = { labour: { fromBani: 100 } };
    preList(given, [{ id: id(3), key: 'diagnosis' }]);
    expect(given).toEqual({ labour: { fromBani: 100 } });
  });
});

describe('the 50 job cap', () => {
  it('can add at 49 and not at 50', () => {
    expect(canAdd({ jobs: jobs(JOBS_MAX - 1) })).toBe(true);
    expect(canAdd({ jobs: jobs(JOBS_MAX) })).toBe(false);
  });

  it('adds the 50th job and refuses the 51st, returning the same section', () => {
    const forty9: PricesSection = { jobs: jobs(49) };
    const fifty = addJob(forty9, { id: id(100) });
    expect(fifty.jobs).toHaveLength(50);
    expect(addJob(fifty, { id: id(101) })).toBe(fifty);
    expect(addProposal(fifty, 'Spălare')).toBe(fifty);
  });

  it('does not count brand ranges toward the cap', () => {
    const section: PricesSection = {
      jobs: [
        ...jobs(49),
        { brandId: DACIA, jobTypeId: id(1) },
        { brandId: BMW, jobTypeId: id(1) },
      ],
    };
    expect(canAdd(section)).toBe(true);
    expect(addJob(section, { id: id(100) }).jobs).toHaveLength(52);
  });

  it('can add again after a removal at the cap', () => {
    const fifty: PricesSection = { jobs: jobs(50) };
    const after = remove(fifty, 0);
    expect(canAdd(after)).toBe(true);
  });

  it('can add to a section with no job list', () => {
    expect(canAdd({})).toBe(true);
    expect(addJob({}, { id: id(1) })).toEqual({ jobs: [{ jobTypeId: id(1) }] });
  });
});

describe('adding jobs and proposals', () => {
  it('does not add the same catalogue job twice', () => {
    const section: PricesSection = { jobs: [{ jobTypeId: id(1) }] };
    expect(addJob(section, { id: id(1) })).toBe(section);
  });

  it('does not add a catalogue job already present as a brand range only', () => {
    const section: PricesSection = {
      jobs: [{ brandId: DACIA, jobTypeId: id(1) }],
    };
    expect(addJob(section, { id: id(1) }).jobs).toHaveLength(2);
  });

  it.each(['', '   ', '\t\n'])('ignores a typed proposal of %j', (typed) => {
    const section: PricesSection = { jobs: [] };
    expect(addProposal(section, typed)).toBe(section);
  });

  it('trims the proposed name it keeps', () => {
    expect(addProposal({ jobs: [] }, '  Spălare motor  ').jobs).toEqual([
      { name: 'Spălare motor' },
    ]);
  });

  it.each(['spălare motor', 'SPĂLARE MOTOR', ' Spălare motor '])(
    'does not add %j when the same proposal is already listed',
    (typed) => {
      const section = addProposal({ jobs: [] }, 'Spălare motor');
      expect(addProposal(section, typed)).toBe(section);
    },
  );

  it('keeps a proposal of eighty-one characters out of the draft shape by leaving the length to the caller', () => {
    const long = 'n'.repeat(81);
    const next = addProposal({ jobs: [] }, long);
    expect(next.jobs).toEqual([{ name: long }]);
  });

  it('treats a proposal and a catalogue job as different rows', () => {
    const section: PricesSection = { jobs: [{ jobTypeId: id(1) }] };
    expect(addProposal(section, 'Diagnoză').jobs).toHaveLength(2);
  });

  it('does not change the section it was given', () => {
    const section: PricesSection = { jobs: [{ jobTypeId: id(1) }] };
    const snapshot = JSON.parse(JSON.stringify(section));
    addJob(section, { id: id(2) });
    addProposal(section, 'x y');
    addBrandRange(section, 0, DACIA);
    setEnds(section, 0, { fromBani: 5 });
    remove(section, 0);
    dropUntaken(section, []);
    expect(section).toEqual(snapshot);
  });
});

describe('brand ranges', () => {
  const base: PricesSection = {
    jobs: [{ jobTypeId: id(1) }, { jobTypeId: id(2) }],
  };

  it('puts the brand row directly under its job row', () => {
    expect(addBrandRange(base, 0, DACIA).jobs).toEqual([
      { jobTypeId: id(1) },
      { brandId: DACIA, jobTypeId: id(1) },
      { jobTypeId: id(2) },
    ]);
  });

  it('puts a second brand row after the first, before the next job', () => {
    const one = addBrandRange(base, 0, DACIA);
    expect(addBrandRange(one, 0, BMW).jobs).toEqual([
      { jobTypeId: id(1) },
      { brandId: DACIA, jobTypeId: id(1) },
      { brandId: BMW, jobTypeId: id(1) },
      { jobTypeId: id(2) },
    ]);
  });

  it('refuses the same brand twice for one job, giving back the same section', () => {
    const one = addBrandRange(base, 0, DACIA);
    expect(addBrandRange(one, 0, DACIA)).toBe(one);
  });

  it('allows the same brand for two different jobs', () => {
    const one = addBrandRange(base, 0, DACIA);
    expect(addBrandRange(one, 2, DACIA).jobs).toHaveLength(4);
  });

  it.each([-1, 2, 99, Number.NaN])(
    'ignores a brand range for the missing row %d',
    (index) => {
      expect(addBrandRange(base, index, DACIA)).toBe(base);
    },
  );

  it('does not hang a brand range under a brand row', () => {
    const one = addBrandRange(base, 0, DACIA);
    const underBrand = addBrandRange(one, 1, BMW);
    expect(underBrand.jobs?.filter((e) => e.brandId === BMW)).toHaveLength(1);
    expect(
      underBrand.jobs?.every(
        (e) => e.jobTypeId === id(1) || e.jobTypeId === id(2),
      ),
    ).toBe(true);
  });

  it('gives a proposed job brand ranges that keep its name and no id', () => {
    const section = addProposal({ jobs: [] }, 'Spălare');
    expect(addBrandRange(section, 0, DACIA).jobs).toEqual([
      { name: 'Spălare' },
      { brandId: DACIA, name: 'Spălare' },
    ]);
  });

  it('copies no prices from the job row to its brand range', () => {
    const section: PricesSection = {
      jobs: [{ fromBani: 10_000, jobTypeId: id(1), toBani: 20_000 }],
    };
    expect(addBrandRange(section, 0, DACIA).jobs?.[1]).toEqual({
      brandId: DACIA,
      jobTypeId: id(1),
    });
  });
});

describe('rows', () => {
  it('is empty for the empty section and for an empty list', () => {
    expect(rows({})).toEqual([]);
    expect(rows({ jobs: [] })).toEqual([]);
  });

  it('groups brand ranges under the job above them with their draft indexes', () => {
    const section: PricesSection = {
      jobs: [
        { jobTypeId: id(1) },
        { brandId: DACIA, jobTypeId: id(1) },
        { jobTypeId: id(2) },
      ],
    };
    const grouped = rows(section);
    expect(grouped.map((r) => [r.index, r.brands.map((b) => b.index)])).toEqual(
      [
        [0, [1]],
        [2, []],
      ],
    );
  });

  it('drops a brand range that comes first, with no job row above it', () => {
    const grouped = rows({ jobs: [{ brandId: DACIA, jobTypeId: id(1) }] });
    expect(grouped).toEqual([]);
  });
});

describe('setEnds', () => {
  it('sets one end and keeps the other', () => {
    const section: PricesSection = {
      jobs: [{ fromBani: 100, jobTypeId: id(1), toBani: 500 }],
    };
    expect(setEnds(section, 0, { toBani: 900 }).jobs).toEqual([
      { fromBani: 100, jobTypeId: id(1), toBani: 900 },
    ]);
  });

  it('removes an end set to undefined instead of keeping 0 or the key', () => {
    const section: PricesSection = {
      jobs: [{ fromBani: 100, jobTypeId: id(1), toBani: 500 }],
    };
    const next = setEnds(section, 0, { toBani: undefined });
    expect(Object.keys(next.jobs?.[0] ?? {}).sort()).toEqual([
      'fromBani',
      'jobTypeId',
    ]);
  });

  it('leaves every other row untouched', () => {
    const section: PricesSection = { jobs: jobs(3) };
    const next = setEnds(section, 1, { fromBani: 100 });
    expect(next.jobs?.[0]).toBe(section.jobs?.[0]);
    expect(next.jobs?.[2]).toBe(section.jobs?.[2]);
  });

  it('changes nothing for an index past the list', () => {
    const section: PricesSection = { jobs: jobs(2) };
    expect(setEnds(section, 9, { fromBani: 100 }).jobs).toEqual(section.jobs);
  });
});

describe('remove', () => {
  const section: PricesSection = {
    jobs: [
      { jobTypeId: id(1) },
      { brandId: DACIA, jobTypeId: id(1) },
      { brandId: BMW, jobTypeId: id(1) },
      { jobTypeId: id(2) },
    ],
  };

  it('takes a job with all its brand ranges and nothing else', () => {
    expect(remove(section, 0).jobs).toEqual([{ jobTypeId: id(2) }]);
  });

  it('takes one brand range alone', () => {
    expect(remove(section, 2).jobs).toEqual([
      { jobTypeId: id(1) },
      { brandId: DACIA, jobTypeId: id(1) },
      { jobTypeId: id(2) },
    ]);
  });

  it.each([-1, 4, 100])('ignores the missing index %d', (index) => {
    expect(remove(section, index)).toBe(section);
  });

  it('can empty the list and leaves jobs as an empty list, not absent', () => {
    expect(remove({ jobs: [{ jobTypeId: id(1) }] }, 0)).toEqual({ jobs: [] });
  });

  it('removes a proposal by name together with its brand ranges, accents and case aside', () => {
    const proposed: PricesSection = {
      jobs: [
        { name: 'Spălare' },
        { brandId: DACIA, name: 'spălare' },
        { jobTypeId: id(1) },
      ],
    };
    expect(remove(proposed, 0).jobs).toEqual([{ jobTypeId: id(1) }]);
  });

  it('keeps the labour range', () => {
    expect(
      remove({ jobs: [{ jobTypeId: id(1) }], labour: { fromBani: 1 } }, 0)
        .labour,
    ).toEqual({ fromBani: 1 });
  });
});

describe('brandOffer', () => {
  const marked: MarkedBrand[] = [
    { brandId: DACIA, name: 'Dacia', stance: 'works_on' },
    { brandId: BMW, name: 'BMW', stance: 'works_on' },
    { brandId: id(903), name: 'Lada', stance: 'does_not_take' },
  ];

  it('offers only the brands taken, minus those already given for that job', () => {
    const section: PricesSection = {
      jobs: [{ jobTypeId: id(1) }, { brandId: DACIA, jobTypeId: id(1) }],
    };
    expect(brandOffer(section, 0, marked).map((b) => b.brandId)).toEqual([BMW]);
  });

  it('offers a brand given for another job', () => {
    const section: PricesSection = {
      jobs: [
        { jobTypeId: id(1) },
        { brandId: DACIA, jobTypeId: id(1) },
        { jobTypeId: id(2) },
      ],
    };
    expect(brandOffer(section, 2, marked).map((b) => b.brandId)).toEqual([
      DACIA,
      BMW,
    ]);
  });

  it('offers nothing when no brand is taken', () => {
    expect(brandOffer({ jobs: jobs(1) }, 0, [])).toEqual([]);
    expect(brandOffer({ jobs: jobs(1) }, 0, [marked[2]])).toEqual([]);
  });

  it.each([-1, 5])('offers nothing for the missing row %d', (index) => {
    expect(brandOffer({ jobs: jobs(1) }, index, marked)).toEqual([]);
  });

  it('offers nothing once every taken brand is given', () => {
    const section: PricesSection = {
      jobs: [
        { jobTypeId: id(1) },
        { brandId: DACIA, jobTypeId: id(1) },
        { brandId: BMW, jobTypeId: id(1) },
      ],
    };
    expect(brandOffer(section, 0, marked)).toEqual([]);
  });
});

describe('dropUntaken', () => {
  const section: PricesSection = {
    jobs: [
      { jobTypeId: id(1) },
      { brandId: DACIA, jobTypeId: id(1) },
      { brandId: BMW, jobTypeId: id(1) },
    ],
  };

  it('drops the brand rows of brands no longer taken and keeps the job rows', () => {
    expect(dropUntaken(section, [DACIA]).jobs).toEqual([
      { jobTypeId: id(1) },
      { brandId: DACIA, jobTypeId: id(1) },
    ]);
  });

  it('drops every brand row when no brand is taken', () => {
    expect(dropUntaken(section, []).jobs).toEqual([{ jobTypeId: id(1) }]);
  });

  it('gives back the same section when nothing is dropped', () => {
    expect(dropUntaken(section, [DACIA, BMW])).toBe(section);
  });

  it('works on a section with no job list', () => {
    const empty: PricesSection = {};
    expect(dropUntaken(empty, [])).toBe(empty);
  });

  it('never drops a job row, even one with no brands taken at all', () => {
    expect(dropUntaken({ jobs: jobs(60) }, []).jobs).toHaveLength(60);
  });
});
