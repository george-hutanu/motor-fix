import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from.
const doc = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../../apps/api/openapi.json'),
    'utf8',
  ),
);
const BASE = '/api/v1/garages/{garageId}/photos';
type Operation = {
  operationId: string;
  security?: unknown;
  requestBody?: { content: Record<string, { schema: { $ref: string } }> };
  responses: Record<string, unknown>;
};
const op = (path: string, method: string): Operation =>
  doc.paths[`${BASE}${path}`]?.[method];

// @traces 1249-FR-020
describe("the owner's gallery in the OpenAPI document", () => {
  it.each([
    ['', 'get', 'list', ['200', '401', '403', '404']],
    ['', 'put', 'save', ['200', '400', '401', '403', '404', '409', '410']],
    [
      '/upload-url',
      'post',
      'uploadAddress',
      ['201', '401', '403', '404', '410', '422', '429'],
    ],
    [
      '/uploads',
      'post',
      'confirm',
      ['201', '401', '403', '404', '409', '410', '422'],
    ],
    ['/uploads/{id}', 'get', 'upload', ['200', '401', '403', '404']],
    [
      '/uploads/{id}',
      'delete',
      'removeUpload',
      ['204', '401', '403', '404', '409', '410'],
    ],
  ])(
    '%s %s is the owner operation %s with its refusals',
    (path, method, name, codes) => {
      const operation = op(path, method);

      expect(operation.operationId).toBe(`OwnerPhotosController_${name}`);
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(codes),
      );
      expect(operation.security).toEqual([{ bearer: [] }]);
    },
  );

  it('takes the whole gallery as the save body and answers the read', () => {
    const save = op('', 'put');

    expect(save.requestBody?.content['application/json']?.schema.$ref).toMatch(
      /SaveGaragePhotosDto$/,
    );
    expect(JSON.stringify(save.responses['200'])).toMatch(/GaragePhotosDto/);
    expect(JSON.stringify(op('', 'get').responses['200'])).toMatch(
      /GaragePhotosDto/,
    );
  });

  it('never names a storage key in the read of a saved photo', () => {
    const photo = doc.components.schemas.GaragePhotoDto;

    expect(Object.keys(photo.properties).sort()).toEqual(
      [
        'caption',
        'height',
        'id',
        'position',
        'processed',
        'thumbnailUrl',
        'width',
      ].sort(),
    );
  });

  it("carries a photo's caption on the public profile", () => {
    expect(
      doc.components.schemas.PublicGaragePhotoDto.properties,
    ).toHaveProperty('caption');
  });
});
