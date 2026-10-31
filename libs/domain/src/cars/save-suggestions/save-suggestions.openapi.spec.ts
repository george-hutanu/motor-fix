import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from, and the
// inventory entry the route's observability is listed in.
const root = join(__dirname, '../../../../..');
const doc = JSON.parse(
  readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
);
const inventory = JSON.parse(
  readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
);

// @traces 293-FR-005 293-FR-006
describe('the save suggestion in the OpenAPI document', () => {
  it('documents the dismiss route, its 204 and its refusals', () => {
    const post =
      doc.paths['/api/v1/me/save-suggestions/{garageId}/dismiss']?.post;

    expect(Object.keys(post.responses).sort()).toEqual([
      '204',
      '400',
      '401',
      '403',
      '404',
    ]);
    expect(post.requestBody).toBeUndefined();
    expect(post.parameters).toEqual([
      expect.objectContaining({ in: 'path', name: 'garageId', required: true }),
    ]);
  });

  it('carries saveSuggestion on the active request, required and nullable', () => {
    const dto = doc.components.schemas.ActiveRequestDto;

    expect(dto.required).toContain('saveSuggestion');
    expect(dto.properties.saveSuggestion.nullable).toBe(true);
    expect(JSON.stringify(dto.properties.saveSuggestion)).toMatch(
      /#\/components\/schemas\/SaveSuggestionDto/,
    );
    expect(doc.components.schemas.SaveSuggestionDto.required.sort()).toEqual([
      'garageId',
      'name',
    ]);
  });

  it('lists the route in the observability inventory', () => {
    const entry = inventory.entries.find(
      (i: { kind: string; name: string }) =>
        i.kind === 'endpoint' && i.name === 'save-suggestions',
    );

    expect(entry?.source).toBe(
      'libs/domain/src/cars/save-suggestions/save-suggestions.controller.ts',
    );
  });
});
