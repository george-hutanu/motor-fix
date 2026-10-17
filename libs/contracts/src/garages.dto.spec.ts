import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PublicGarageDto, PublicGarageQueryDto } from './garages.dto';

// Any error here is the 400 validation_failed the API answers.
const errors = (query: Record<string, unknown>) =>
  validateSync(plainToInstance(PublicGarageQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });

const constraints = (query: Record<string, unknown>) =>
  errors(query).flatMap((e) => Object.keys(e.constraints ?? {}));

type Documented = { required?: boolean; type?: unknown };

const documented = (dto: abstract new () => object, name: string) =>
  Reflect.getMetadata('swagger/apiModelProperties', dto.prototype, name) as
    | Documented
    | undefined;

// @traces 271-garage-distance-FR-014
describe('PublicGarageQueryDto', () => {
  it('takes a brand and a place in Romania together', () => {
    expect(errors({ brand: 'dacia', near: '46.771,23.624' })).toEqual([]);
  });

  it('takes neither', () => {
    expect(errors({})).toEqual([]);
  });

  it.each(['46.771', '46.771,23.624,1', 'abc,def', '46.771, 23.624', ''])(
    'refuses the malformed place %p',
    (near) => {
      expect(errors({ near })).not.toEqual([]);
    },
  );

  it.each([
    ['Budapest', '47.4979,19.0402'],
    ['Sofia', '42.6977,23.3219'],
  ])('refuses a place in %s, outside Romania', (_, near) => {
    expect(constraints({ near })).toEqual(['nearInRomania']);
  });

  it('documents the place for the generated client', () => {
    expect(documented(PublicGarageQueryDto, 'near')).toMatchObject({
      required: false,
    });
  });
});

describe('PublicGarageDto', () => {
  it('may carry the distance in kilometres from the place', () => {
    expect(documented(PublicGarageDto, 'distanceKm')).toMatchObject({
      required: false,
      type: Number,
    });
  });
});
