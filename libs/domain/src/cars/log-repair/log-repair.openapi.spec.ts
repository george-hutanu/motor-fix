import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from.
const doc = JSON.parse(
  readFileSync(join(__dirname, '../../../../../apps/api/openapi.json'), 'utf8'),
);

// @traces 062-FR-012
describe('logging a repair and picking a garage, in the OpenAPI document', () => {
  it('publishes the log with the body it takes and every answer it gives', () => {
    const post = doc.paths['/api/v1/cars/{id}/repairs']?.post;

    expect(post?.requestBody.content['application/json'].schema.$ref).toMatch(
      /LogRepairDto$/,
    );
    expect(
      post?.responses['201'].content['application/json'].schema.$ref,
    ).toMatch(/CarRepairDto$/);
    expect(Object.keys(post?.responses ?? {}).sort()).toEqual([
      '201',
      '400',
      '401',
      '404',
      '409',
      '422',
    ]);
  });

  it('publishes the garage search with its two query fields', () => {
    const get = doc.paths['/api/v1/garages']?.get;

    expect(get?.parameters.map((p: { name: string }) => p.name).sort()).toEqual(
      ['limit', 'q'],
    );
    expect(
      get?.responses['200'].content['application/json'].schema.$ref,
    ).toMatch(/GaragePickListDto$/);
    expect(Object.keys(get?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '404',
    ]);
  });
});
