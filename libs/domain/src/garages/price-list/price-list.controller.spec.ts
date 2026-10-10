import { PriceListController } from './price-list.controller';

// @nestjs/swagger's API_PARAMETERS; its dist path has no types.
const API_PARAMETERS = 'swagger/apiParameters';

describe('PriceListController OpenAPI', () => {
  it('declares garageId as a uuid, as ParseUUIDPipe enforces (FR-009)', () => {
    const params: { format?: string; name: string }[] =
      Reflect.getMetadata(API_PARAMETERS, PriceListController.prototype.read) ??
      [];
    const garageId = params.find((p) => p.name === 'garageId');
    expect(garageId?.format).toBe('uuid');
  });
});
