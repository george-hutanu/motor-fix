import { JOB_NAME_MAX, JOBS_MAX } from './listing-sections';
import { isBrandsSection } from './marked-brands';

const DACIA = '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c';
const BMW = '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const section = (unticked: unknown, stance = 'works_on') => ({
  brands: [{ brandId: DACIA, name: 'Dacia', stance, unticked }],
});

describe('the unticked jobs of a taken brand in step 2', () => {
  it('accepts an absent list, an empty list and a list of one uuid or one name', () => {
    expect(isBrandsSection(section(undefined))).toBe(true);
    expect(isBrandsSection(section([]))).toBe(true);
    expect(isBrandsSection(section([uuid(1)]))).toBe(true);
    expect(isBrandsSection(section(['Reglaj faruri']))).toBe(true);
  });

  it('accepts exactly the price list bound and refuses one more', () => {
    const at = Array.from({ length: JOBS_MAX }, (_, i) => uuid(i + 1));
    const past = Array.from({ length: JOBS_MAX + 1 }, (_, i) => uuid(i + 1));
    expect(JOBS_MAX).toBe(50);
    expect(isBrandsSection(section(at))).toBe(true);
    expect(isBrandsSection(section(past))).toBe(false);
  });

  it('counts the bound over names as well as uuids', () => {
    const names = (n: number) =>
      Array.from({ length: n }, (_, i) => `Job ${i}`);
    expect(isBrandsSection(section(names(JOBS_MAX)))).toBe(true);
    expect(isBrandsSection(section(names(JOBS_MAX + 1)))).toBe(false);
  });

  it('refuses the same uuid twice, also when one is in capitals', () => {
    expect(isBrandsSection(section([uuid(10), uuid(10)]))).toBe(false);
    const lower = 'abcdefab-2f8e-4b1f-8c2a-1d4e5f6a7b8c';
    expect(isBrandsSection(section([lower, lower.toUpperCase()]))).toBe(false);
  });

  it('refuses the same name twice', () => {
    expect(isBrandsSection(section(['Reglaj faruri', 'Reglaj faruri']))).toBe(
      false,
    );
  });

  it('keeps two names that differ only by case apart, as the write matches names exactly', () => {
    expect(isBrandsSection(section(['Reglaj faruri', 'reglaj faruri']))).toBe(
      true,
    );
  });

  it('refuses any list, even an empty one, on a refused brand', () => {
    expect(isBrandsSection(section([uuid(1)], 'does_not_take'))).toBe(false);
    expect(isBrandsSection(section([], 'does_not_take'))).toBe(false);
  });

  it('refuses a null list', () => {
    expect(isBrandsSection(section(null))).toBe(false);
  });

  it.each([
    ['a string instead of a list', 'Reglaj faruri'],
    ['an object instead of a list', { 0: uuid(1) }],
    ['a number in the list', [7]],
    ['a null in the list', [null]],
    ['an undefined hole in the list', [undefined]],
    ['a nested list', [[uuid(1)]]],
    ['an empty name', ['']],
    [
      'a name longer than the price list allows',
      ['n'.repeat(JOB_NAME_MAX + 1)],
    ],
  ])('refuses %s', (_, unticked) => {
    expect(isBrandsSection(section(unticked))).toBe(false);
  });

  it('accepts a name at the price list limit', () => {
    expect(isBrandsSection(section(['n'.repeat(JOB_NAME_MAX)]))).toBe(true);
    expect(isBrandsSection(section(['ș'.repeat(JOB_NAME_MAX)]))).toBe(true);
    expect(isBrandsSection(section(['😀'.repeat(JOB_NAME_MAX / 2)]))).toBe(
      true,
    );
  });

  it('refuses a brand with a misspelt key beside unticked', () => {
    expect(
      isBrandsSection({
        brands: [
          { brandId: BMW, jobs: [uuid(1)], name: 'BMW', stance: 'works_on' },
        ],
      }),
    ).toBe(false);
    expect(
      isBrandsSection({
        brands: [
          { brandId: BMW, name: 'BMW', stance: 'works_on', Unticked: [] },
        ],
      }),
    ).toBe(false);
  });
});
