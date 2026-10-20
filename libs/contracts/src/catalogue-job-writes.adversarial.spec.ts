import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CatalogueJobProposalDto } from './catalogue-job-proposal.dto';
import { PriceAddDto, PriceRangeDto } from './price-list.dto';

const strict = { forbidNonWhitelisted: true, whitelist: true };
const problemsOf = async (type: new () => object, plain: unknown) =>
  (await validate(plainToInstance(type, plain as object), strict)).map(
    (error) => error.property,
  );

const jobTypeId = '3f2b8c1e-5d4a-4b7e-9a60-1c2d3e4f5a6b';

// @traces 1352-catalogue-job-visibility-FR-010
describe('the body of a job proposal under hostile names', () => {
  const base = { fromBani: 60_000 };

  it('takes a name of exactly three characters and one of exactly 80', async () => {
    expect(
      await problemsOf(CatalogueJobProposalDto, { ...base, name: 'abc' }),
    ).toEqual([]);
    expect(
      await problemsOf(CatalogueJobProposalDto, {
        ...base,
        name: 'x'.repeat(80),
      }),
    ).toEqual([]);
  });

  it('measures 80 characters after trimming, not before', async () => {
    expect(
      await problemsOf(CatalogueJobProposalDto, {
        ...base,
        name: `  ${'x'.repeat(80)}\t\n `,
      }),
    ).toEqual([]);
  });

  it.each([
    ['only whitespace', '          '],
    ['an empty string', ''],
    ['a null', null],
    ['an array', ['Injectoare']],
    ['an object', { toString: 'x' }],
    ['a newline inside', 'Ulei\nmotor'],
    ['a tab inside', 'Ulei\tmotor'],
    ['a delete character inside', 'Ulei\u007fmotor'],
  ])('refuses a name that is %s', async (_, name) => {
    expect(
      await problemsOf(CatalogueJobProposalDto, { ...base, name }),
    ).toEqual(['name']);
  });

  it('refuses a jobTypeId, since a proposal names no catalogue job', async () => {
    expect(
      await problemsOf(CatalogueJobProposalDto, {
        ...base,
        jobTypeId,
        name: 'Injectoare',
      }),
    ).toEqual(['jobTypeId']);
  });

  it('keeps the trimmed name as the value later code reads', () => {
    const dto = plainToInstance(CatalogueJobProposalDto, {
      name: '  Injectoare  ',
    });

    expect(dto.name).toBe('Injectoare');
  });
});

// @traces 1352-catalogue-job-visibility-FR-002
describe('the body of a catalogue job add under hostile input', () => {
  it.each([
    ['a missing id', undefined],
    ['null', null],
    ['a number', 7],
    ['an id with a stray character', `${jobTypeId}x`],
    ['a path-like string', '../../etc/passwd'],
  ])('refuses %s as the job id', async (_, value) => {
    expect(
      await problemsOf(PriceAddDto, { fromBani: 1_000, jobTypeId: value }),
    ).toEqual(['jobTypeId']);
  });

  it('refuses a stamp the add has no use for', async () => {
    expect(
      await problemsOf(PriceAddDto, {
        expectedUpdatedAt: '2026-10-20T10:00:00.000Z',
        fromBani: 1_000,
        jobTypeId,
      }),
    ).toEqual(['expectedUpdatedAt']);
  });

  it('refuses the visible flag, which is a hide or show alone', async () => {
    expect(
      await problemsOf(PriceAddDto, {
        fromBani: 1_000,
        jobTypeId,
        visible: true,
      }),
    ).toEqual(['visible']);
  });

  it('refuses a position the owner has no say in', async () => {
    expect(
      await problemsOf(PriceAddDto, {
        fromBani: 1_000,
        jobTypeId,
        position: 0,
      }),
    ).toEqual(['position']);
  });
});

// @traces 1352-catalogue-job-visibility-FR-005
describe('the visible flag of a hide or show', () => {
  it.each([
    ['the number 0', 0],
    ['the number 1', 1],
    ['an empty string', ''],
    ['an array', [true]],
  ])('refuses a visible that is %s', async (_, visible) => {
    expect(await problemsOf(PriceRangeDto, { visible })).toEqual(['visible']);
  });

  it('refuses an empty body, which is neither shape', async () => {
    expect(await problemsOf(PriceRangeDto, {})).toContain('expectedUpdatedAt');
  });
});
