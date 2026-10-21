import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CreateListingDraftDto,
  ListingDraftCreatedDto,
  SaveListingDraftDto,
} from './listing-drafts.dto';
import { LISTING_SUBMIT_CONFLICTS } from './listing-submit.dto';

const openapi = JSON.parse(
  readFileSync(join(__dirname, '../../../apps/api/openapi.json'), 'utf8'),
);
const schema = (name: string) => openapi.components.schemas[name];

const problems = (
  type: typeof CreateListingDraftDto | typeof SaveListingDraftDto,
  email: unknown,
) =>
  validateSync(
    plainToInstance(type, {
      data: {},
      email,
      language: 'ro',
      step: 1,
    }),
  ).map((error) => error.property);

// @traces 116-FR-031
describe('the draft e-mail cap', () => {
  it.each([CreateListingDraftDto, SaveListingDraftDto])(
    'takes 254 characters and refuses 255 on %p',
    (type) => {
      expect(problems(type, 'a'.repeat(254))).toEqual([]);
      expect(problems(type, 'a'.repeat(255))).toEqual(['email']);
    },
  );

  it('measures the e-mail after trimming and lower-casing', () => {
    expect(problems(CreateListingDraftDto, `  ${'A'.repeat(254)}  `)).toEqual(
      [],
    );
  });

  it('counts characters, not bytes, so 254 two-byte letters pass', () => {
    expect(problems(CreateListingDraftDto, 'é'.repeat(254))).toEqual([]);
  });

  it('refuses a missing, null or numeric e-mail on create', () => {
    for (const email of [undefined, null, 5, {}, []])
      expect(problems(CreateListingDraftDto, email)).toEqual(['email']);
  });

  it('leaves the e-mail out on a save without refusing it', () => {
    expect(problems(SaveListingDraftDto, undefined)).toEqual([]);
  });

  it('says 254 in the published contract for both bodies', () => {
    expect(schema('CreateListingDraftDto').properties.email.maxLength).toBe(
      254,
    );
    expect(schema('SaveListingDraftDto').properties.email.maxLength).toBe(254);
  });
});

// @traces 116-FR-034
describe('the created draft in the published contract', () => {
  it('requires the token and linkSent that every create answers', () => {
    expect(schema('ListingDraftCreatedDto').required).toEqual(
      expect.arrayContaining(['token', 'linkSent']),
    );
  });

  it('keeps them optional on the saved draft, which answers neither', () => {
    expect(schema('ListingDraftSavedDto').required ?? []).not.toContain(
      'token',
    );
    expect(schema('ListingDraftSavedDto').required ?? []).not.toContain(
      'linkSent',
    );
  });

  it('is still assignable where a saved draft is read', () => {
    const created = plainToInstance(ListingDraftCreatedDto, { token: 't' });
    expect(created.token).toBe('t');
  });
});

// @traces 116-FR-018
describe('the send and status contracts as published', () => {
  const submit = openapi.paths['/api/v1/listing-drafts/{id}/submit'].post;
  const status = openapi.paths['/api/v1/garages/{garageId}/verification'].get;

  it('requires every field of the send answer and limits its status to two values', () => {
    expect(schema('ListingSubmittedDto').required).toEqual(
      expect.arrayContaining(['garageId', 'fileId', 'status', 'warnings']),
    );
    expect(schema('ListingSubmittedDto').properties.status.enum).toEqual([
      'submitted',
      'approved',
    ]);
  });

  it('names exactly the two conflicts of the send', () => {
    expect([...LISTING_SUBMIT_CONFLICTS]).toEqual([
      'draft_already_submitted',
      'garage_already_exists',
    ]);
  });

  it('answers 413 and 422 on the send, as the contract promises', () => {
    expect(Object.keys(submit.responses)).toEqual(
      expect.arrayContaining(['201', '400', '401', '404', '409', '422', '413']),
    );
  });

  it('answers 401, 403 and 404 on the status read, returning the status body on 200', () => {
    expect(Object.keys(status.responses)).toEqual(
      expect.arrayContaining(['200', '401', '403', '404']),
    );
    expect(
      status.responses['200'].content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/VerificationStatusDto');
  });

  it('requires all four status fields and lists the six statuses', () => {
    expect(schema('VerificationStatusDto').required).toEqual(
      expect.arrayContaining([
        'status',
        'submittedAt',
        'requestedItems',
        'reason',
      ]),
    );
    expect(schema('VerificationStatusDto').properties.status.enum).toEqual([
      'draft',
      'submitted',
      'in_review',
      'more_requested',
      'rejected',
      'approved',
    ]);
  });
});
