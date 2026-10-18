import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { GarageLabourController } from './labour.controller';
import { JsonOnly } from '../../../auth/auth.controller';

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

// @traces 173-FR-005
describe('the labour route', () => {
  it("changes the garage's labour range with a JSON PATCH of its own", () => {
    const { set } = GarageLabourController.prototype;

    expect(Reflect.getMetadata(PATH_METADATA, GarageLabourController)).toBe(
      'garages/:garageId/labour',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, set)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata(GUARDS_METADATA, set)).toContain(JsonOnly);
    expect(uuidParams(set)).toEqual(['garageId']);
  });
});
