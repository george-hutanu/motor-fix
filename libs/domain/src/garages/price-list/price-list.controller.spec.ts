import { HttpStatus, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { PriceListController } from './price-list.controller';
import { JsonOnly } from '../../auth/auth.controller';

// @nestjs/swagger's API_PARAMETERS; its dist path has no types.
const API_PARAMETERS = 'swagger/apiParameters';

const uuidParams = (handler: object) =>
  (
    (Reflect.getMetadata(API_PARAMETERS, handler) ?? []) as {
      format?: string;
      name: string;
    }[]
  )
    .filter((p) => p.format === 'uuid')
    .map((p) => p.name)
    .sort();

describe('PriceListController OpenAPI', () => {
  it('declares garageId as a uuid, as ParseUUIDPipe enforces', () => {
    expect(uuidParams(PriceListController.prototype.read)).toEqual([
      'garageId',
    ]);
  });
});

// @traces 386-FR-005
// @traces 386-FR-007
describe('the brand range routes', () => {
  const { removeBrandRange, setBrandRange } = PriceListController.prototype;

  it('sets a range with a JSON PUT on the job and brand', () => {
    expect(Reflect.getMetadata(METHOD_METADATA, setBrandRange)).toBe(
      RequestMethod.PUT,
    );
    expect(Reflect.getMetadata(PATH_METADATA, setBrandRange)).toBe(
      ':jobTypeId/brands/:brandId',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, setBrandRange)).toContain(
      JsonOnly,
    );
    expect(uuidParams(setBrandRange)).toEqual([
      'brandId',
      'garageId',
      'jobTypeId',
    ]);
  });

  it('removes a range with a DELETE that answers no content', () => {
    expect(Reflect.getMetadata(METHOD_METADATA, removeBrandRange)).toBe(
      RequestMethod.DELETE,
    );
    expect(Reflect.getMetadata(PATH_METADATA, removeBrandRange)).toBe(
      ':jobTypeId/brands/:brandId',
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, removeBrandRange)).toBe(
      HttpStatus.NO_CONTENT,
    );
    expect(uuidParams(removeBrandRange)).toEqual([
      'brandId',
      'garageId',
      'jobTypeId',
    ]);
  });
});
