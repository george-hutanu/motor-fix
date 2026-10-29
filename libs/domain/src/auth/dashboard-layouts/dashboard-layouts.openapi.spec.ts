import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from.
const doc = JSON.parse(
  readFileSync(join(__dirname, '../../../../../apps/api/openapi.json'), 'utf8'),
);
const item = () => doc.paths['/api/v1/me/dashboard-layouts/{role}'];
const ref = (op: { responses: Record<string, { content?: unknown }> }) =>
  (
    op.responses['200'].content as {
      'application/json': { schema: { $ref: string } };
    }
  )['application/json'].schema.$ref;

// @traces 1263-admin-dashboard-customise-FR-003
// @traces 1263-admin-dashboard-customise-FR-004
// @traces 1263-admin-dashboard-customise-FR-005
// @traces 1263-admin-dashboard-customise-FR-006
describe('the dashboard layouts in the OpenAPI document', () => {
  it('reads, saves and resets under one path', () => {
    expect(Object.keys(item()).sort()).toEqual(['delete', 'get', 'put']);
  });

  it.each([
    ['get', ['200', '401', '403', '404']],
    ['put', ['200', '400', '401', '403', '404']],
    ['delete', ['200', '401', '403', '404']],
  ])('%s answers the layout and documents its refusals', (method, codes) => {
    const op = item()[method];

    expect(Object.keys(op.responses).sort()).toEqual(codes);
    expect(ref(op)).toMatch(/DashboardLayoutDto$/);
    expect(op.security).toEqual([{ bearer: [] }]);
  });

  it('takes the whole layout as the save body', () => {
    const body = item().put.requestBody;

    expect(body.required).toBe(true);
    expect(body.content['application/json'].schema.$ref).toMatch(
      /PutDashboardLayoutDto$/,
    );
  });

  it('answers a nullable updatedAt', () => {
    const schema = doc.components.schemas.DashboardLayoutDto;

    expect(schema.required).toEqual(
      expect.arrayContaining(['role', 'panels', 'updatedAt']),
    );
    expect(schema.properties.updatedAt.nullable).toBe(true);
  });
});
