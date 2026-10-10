import 'reflect-metadata';

import { GarageBrandsController } from './garage-brands.controller';

// @nestjs/swagger's DECORATORS.API_RESPONSE; its dist path is not exported.
const API_RESPONSE = 'swagger/apiResponse';

describe('GarageBrandsController OpenAPI', () => {
  it("names every 400 refusal of the brands PUT, the job ticks' included", () => {
    const responses = Reflect.getMetadata(
      API_RESPONSE,
      GarageBrandsController.prototype.replace,
    ) as Record<string, { description?: string }>;
    const description = responses['400']?.description ?? '';

    expect(description).toContain('validation_failed');
    expect(description).toContain('job_not_priced');
    expect(description).toContain('jobs_on_refused');
  });
});
