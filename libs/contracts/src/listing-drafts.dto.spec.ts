import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CreateListingDraftDto,
  ListingDraftCreatedDto,
  SaveListingDraftDto,
} from './listing-drafts.dto';
import { isListingDraftData } from './listing-sections';

const JOB = '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10';
const BRAND = '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c';

describe('the draft envelope', () => {
  it('accepts good details, prices and mechanics sections', () => {
    expect(
      isListingDraftData({
        steps: {
          '1': { businessKind: 'pfa', name: 'Service Ion' },
          '3': { jobs: [{ fromBani: 10_000, jobTypeId: JOB }], labour: {} },
          '4': { mechanics: [{ name: 'Ion' }], onProfile: true },
        },
      }),
    ).toBe(true);
  });

  it.each([
    ['details', { '1': { businessKind: 'srl' } }],
    ['prices', { '3': { jobs: [{ fromBani: 100 }] } }],
    ['mechanics', { '4': { onProfile: 'no' } }],
  ])('refuses malformed %s', (_, steps) => {
    expect(isListingDraftData({ steps })).toBe(false);
  });

  it('holds step 2 to the brands rules', () => {
    expect(isListingDraftData({ steps: { '2': { anything: 1 } } })).toBe(false);
  });

  it('refuses fuels on a refused brand in step 2', () => {
    expect(
      isListingDraftData({
        steps: {
          '2': {
            brands: [
              {
                brandId: BRAND,
                fuels: ['diesel'],
                name: 'BMW',
                stance: 'does_not_take',
              },
            ],
          },
        },
      }),
    ).toBe(false);
  });

  it('keeps steps 2 and 5 saved before fuels and payments existed', () => {
    expect(
      isListingDraftData({
        steps: {
          '2': {
            brandNote: 'Doar autoturisme',
            brands: [{ brandId: BRAND, name: 'Dacia', stance: 'works_on' }],
          },
          '5': { facilities: ['courtesy_car'] },
        },
      }),
    ).toBe(true);
  });

  it('refuses a step 5 payment it does not know', () => {
    expect(
      isListingDraftData({ steps: { '5': { payments: ['cheque'] } } }),
    ).toBe(false);
  });

  it('keeps a place beside the opening hours in step 5', () => {
    expect(
      isListingDraftData({
        steps: {
          '5': {
            facilities: [],
            place: { address: 'Strada Exemplu 1', lat: 44.43, lng: 26.1 },
          },
        },
      }),
    ).toBe(true);
  });

  it('keeps step 5 with no place', () => {
    expect(isListingDraftData({ steps: { '5': { facilities: [] } } })).toBe(
      true,
    );
  });

  it.each([
    ['a latitude alone', { lat: 44.43 }],
    ['a radius past the limit', { radiusKm: 101 }],
    ['an unknown key', { seat: 'Strada Exemplu 1' }],
    ['text in place of a record', 'Strada Exemplu 1'],
  ])('refuses a step 5 place with %s', (_, place) => {
    expect(isListingDraftData({ steps: { '5': { place } } })).toBe(false);
  });
});

describe('the file keys of a draft', () => {
  const DRAFT = '7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00';
  const ID = '5e0a8f3b-91c2-4d7e-8b6a-0c4f2e9d1a37';

  it('accepts the photo keys storage issues', () => {
    expect(isListingDraftData({ files: [`garage_photo/${DRAFT}/${ID}`] })).toBe(
      true,
    );
  });

  it.each([
    ['an incoming key', `incoming/garage_photo/${DRAFT}/${ID}`],
    ['a processed copy', `garage_photo/${DRAFT}/${ID}.thumb`],
    ['an upper-case purpose', `Garage_Photo/${DRAFT}/${ID}`],
    ['a path step', `garage_photo/${DRAFT}/../${ID}`],
    ['a short owner', `garage_photo/abc/${ID}`],
  ])('refuses %s', (_, key) => {
    expect(isListingDraftData({ files: [key] })).toBe(false);
  });
});

const emailOf = (length: number) =>
  `${'a'.repeat(length - '@example.test'.length)}@example.test`;

const emailErrors = (dto: new () => object, email: string) =>
  validateSync(
    plainToInstance(dto, { data: {}, email, language: 'ro', step: 1 }),
  ).filter((error) => error.property === 'email');

// @traces 116-FR-031
describe('the e-mail of a listing draft', () => {
  it.each([
    ['created', CreateListingDraftDto],
    ['saved', SaveListingDraftDto],
  ])('is refused past 254 characters when a draft is %s', (_, dto) => {
    expect(emailErrors(dto, emailOf(254))).toEqual([]);
    expect(emailErrors(dto, emailOf(255))).not.toEqual([]);
  });
});

// @traces 116-FR-034
describe('a created listing draft', () => {
  it.each(['token', 'linkSent'])('always carries %s', (name) => {
    const documented = Reflect.getMetadata(
      'swagger/apiModelProperties',
      ListingDraftCreatedDto.prototype,
      name,
    ) as { required?: boolean } | undefined;

    expect(documented?.required).toBe(true);
  });
});
