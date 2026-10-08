import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { GarageSearchQueryDto } from './garage-search.dto';
import { HomeQueryDto } from './home.dto';
import { NearQueryDto } from './near.dto';

const BRAND_ID = '6f1c7b0e-2a4d-4c55-9a39-5b0f3f1f9a10';

const errors = (dto: new () => object, query: Record<string, unknown>) =>
  validateSync(plainToInstance(dto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });

const constraints = (dto: new () => object, query: Record<string, unknown>) =>
  errors(dto, query).flatMap((e) => Object.keys(e.constraints ?? {}));

describe('NearQueryDto', () => {
  it('needs no place', () => {
    expect(errors(NearQueryDto, {})).toEqual([]);
  });

  it.each([
    '44.43,26.10',
    '46.771,23.624',
    '43.5,20.2',
    '48.4,29.8',
    '44.426812,26.102538',
  ])('takes the place %s in Romania', (near) => {
    expect(errors(NearQueryDto, { near })).toEqual([]);
  });

  it.each(['91,26', '44,181', '44', '44,26,1', 'abc,def', 'NaN,1', ''])(
    'refuses the place %s that is not a point',
    (near) => {
      expect(errors(NearQueryDto, { near })).not.toEqual([]);
    },
  );

  it.each([
    ['Budapest', '47.4979,19.0402'],
    ['Sofia', '42.6977,23.3219'],
    ['the equator', '0,0'],
    ['the south pole', '-90,-180'],
    ['just south of the box', '43.49,25'],
    ['just east of the box', '45,29.81'],
  ])('refuses a place in %s, outside Romania', (_, near) => {
    expect(constraints(NearQueryDto, { near })).toEqual(['nearInRomania']);
  });
});

describe('the reads that take a place', () => {
  it('lets the Home read take a place in Romania and refuse one outside', () => {
    expect(
      errors(HomeQueryDto, { brand: 'dacia', near: '46.771,23.624' }),
    ).toEqual([]);
    expect(
      constraints(HomeQueryDto, { brand: 'dacia', near: '50,10' }),
    ).toEqual(['nearInRomania']);
  });

  it('lets the garage search take a place in Romania and refuse one outside', () => {
    expect(
      errors(GarageSearchQueryDto, {
        brandId: BRAND_ID,
        near: '46.771,23.624',
      }),
    ).toEqual([]);
    expect(
      constraints(GarageSearchQueryDto, { brandId: BRAND_ID, near: '50,10' }),
    ).toEqual(['nearInRomania']);
    expect(
      errors(GarageSearchQueryDto, { brandId: BRAND_ID, near: '44' }),
    ).not.toEqual([]);
  });
});
