import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const openapi = JSON.parse(
  readFileSync(join(__dirname, '../../../../../apps/api/openapi.json'), 'utf8'),
) as { paths: Record<string, Record<string, unknown>> };

const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

// Every operation under the reviews paths, as "METHOD path".
const operations = Object.entries(openapi.paths)
  .filter(
    ([path]) =>
      path.startsWith('/api/v1/reviews') ||
      /^\/api\/v1\/garages\/\{[^}]+\}\/reviews/.test(path),
  )
  .flatMap(([path, item]) =>
    Object.keys(item)
      .filter((method) => METHODS.includes(method))
      .map((method) => `${method.toUpperCase()} ${path}`),
  );

// @traces 074-FR-011
describe('what a garage may do to its reviews through the API', () => {
  it('offers the garage’s own list as a read', () => {
    expect(operations).toContain('GET /api/v1/garages/{garageId}/reviews');
  });

  // The owner's report (ST-76) hides a review only until an admin decides.
  it('holds no edit, hide or delete, and no write but the driver’s post and the owner’s report', () => {
    const writes = operations.filter((op) => !op.startsWith('GET '));

    expect(writes.sort()).toEqual([
      'POST /api/v1/reviews',
      'POST /api/v1/reviews/{reviewId}/reports',
    ]);
  });
});
