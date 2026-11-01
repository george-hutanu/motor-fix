import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OwnerPhotosController } from './owner-photos.controller';
import { JsonOnly } from '../../../auth/auth.controller';

const doc = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../../apps/api/openapi.json'),
    'utf8',
  ),
);
const BASE = '/api/v1/garages/{garageId}/photos';

const proto = OwnerPhotosController.prototype as unknown as Record<
  string,
  object
>;
const handlers = Object.getOwnPropertyNames(proto).filter(
  (name) => name !== 'constructor',
);

// @traces 1249-FR-008
describe("the owner's gallery routes as mounted", () => {
  it('has six handlers and none of them public', () => {
    expect(handlers).toHaveLength(6);
    for (const name of handlers) {
      expect(Reflect.getMetadata('auth:public', proto[name])).toBeUndefined();
    }
    expect(
      Reflect.getMetadata('auth:public', OwnerPhotosController),
    ).toBeUndefined();
  });

  it('guards every body-carrying write with the JSON-only guard', () => {
    const guarded = handlers.filter((name) =>
      (Reflect.getMetadata('__guards__', proto[name]) ?? []).includes(JsonOnly),
    );

    expect(guarded).toHaveLength(3);
  });
});

// @traces 1249-FR-020 1249-FR-004
describe("the owner's gallery in the published document", () => {
  const schemas = doc.components.schemas;

  it('shows the save body with its one-to-twenty bound', () => {
    expect(schemas.SaveGaragePhotosDto.properties.photos).toMatchObject({
      maxItems: 20,
      minItems: 1,
    });
    expect(schemas.SaveGaragePhotosDto.required).toEqual(
      expect.arrayContaining(['photos', 'version']),
    );
  });

  it('bounds a caption at eighty in the save entry', () => {
    expect(schemas.SaveGaragePhotoEntryDto.properties.caption.maxLength).toBe(
      80,
    );
  });

  it.each(['GaragePhotoDto', 'GaragePhotosDto', 'PublicGaragePhotoDto'])(
    'leaves a storage path out of %s',
    (name) => {
      const names = Object.keys(schemas[name].properties);

      expect(names).not.toContain('fileKey');
      expect(names).not.toContain('variantPath');
      expect(names).not.toContain('bucket');
    },
  );

  it('requires the garage id in the path as a uuid on every operation', () => {
    for (const path of Object.keys(doc.paths).filter((p) =>
      p.startsWith(BASE),
    )) {
      for (const operation of Object.values<{
        parameters: { in: string; name: string; schema: { format?: string } }[];
      }>(doc.paths[path])) {
        const garage = operation.parameters.find((p) => p.name === 'garageId');
        expect(garage?.in).toBe('path');
      }
    }
  });

  it('exposes exactly the six operations under the gallery path', () => {
    const operations = Object.keys(doc.paths)
      .filter((p) => p.startsWith(BASE))
      .flatMap((p) => Object.keys(doc.paths[p]).map((m) => `${m} ${p}`))
      .sort();

    expect(operations).toEqual(
      [
        `get ${BASE}`,
        `put ${BASE}`,
        `post ${BASE}/upload-url`,
        `post ${BASE}/uploads`,
        `get ${BASE}/uploads/{id}`,
        `delete ${BASE}/uploads/{id}`,
      ].sort(),
    );
  });
});
