import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CatalogueJobProposalDto } from './catalogue-job-proposal.dto';

const strict = { forbidNonWhitelisted: true, whitelist: true };
const problemsOf = async (plain: object) =>
  (await validate(plainToInstance(CatalogueJobProposalDto, plain), strict)).map(
    (error) => error.property,
  );

const root = join(__dirname, '..', '..', '..');

// @traces 1352-catalogue-job-visibility-FR-017
describe('the body of a job proposal', () => {
  const body = {
    durationMinutes: 90,
    fromBani: 60_000,
    name: 'Recondiționare injectoare',
    toBani: 90_000,
  };

  it('takes the name and the three values', async () => {
    expect(await problemsOf(body)).toEqual([]);
  });

  it('takes the name with a starting price alone, or null for the top and the duration', async () => {
    expect(await problemsOf({ fromBani: 60_000, name: body.name })).toEqual([]);
    expect(
      await problemsOf({ ...body, durationMinutes: null, toBani: null }),
    ).toEqual([]);
  });

  it('leaves values that are not whole or missing to the one range check', async () => {
    expect(
      await problemsOf({ ...body, fromBani: undefined, toBani: 2.5 }),
    ).toEqual([]);
  });

  it('trims the name before measuring it', async () => {
    const dto = plainToInstance(CatalogueJobProposalDto, {
      ...body,
      name: '  Abc  ',
    });

    expect(dto.name).toBe('Abc');
    expect(await validate(dto, strict)).toEqual([]);
  });

  it.each([
    ['a missing name', { name: undefined }],
    ['a name of two characters after trimming', { name: ' Ab ' }],
    ['a name over 80 characters', { name: 'x'.repeat(81) }],
    ['a name that is not text', { name: 42 }],
    ['a name with a control character', { name: 'Ulei\u0000motor' }],
  ])('refuses %s on the name', async (_, values) => {
    expect(await problemsOf({ ...body, ...values })).toEqual(['name']);
  });

  it('refuses an unknown field', async () => {
    expect(await problemsOf({ ...body, visible: false })).toEqual(['visible']);
  });

  it('is carried by the generated client with the same path and answer', () => {
    const propose = readFileSync(
      join(
        root,
        'libs/data-access/src/lib/fn/garages/catalogue-jobs-controller-propose.ts',
      ),
      'utf8',
    );

    expect(propose).toContain(
      "catalogueJobsControllerPropose.PATH = '/api/v1/garages/{garageId}/catalogue-jobs'",
    );
    expect(propose).toContain('StrictHttpResponse<PriceRangeSavedDto>');
  });
});
