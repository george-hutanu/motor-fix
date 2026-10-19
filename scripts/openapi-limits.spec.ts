import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The API document the web client is generated from: every limited route
// names its 429 and the code a caller reads.
type Operation = { responses?: Record<string, { description?: string }> };
const document = JSON.parse(
  readFileSync(join(__dirname, '..', 'apps', 'api', 'openapi.json'), 'utf8'),
) as { paths: Record<string, Record<string, Operation>> };

// @traces 1181-FR-010
describe('rate-limited routes in the API document', () => {
  it.each([
    ['post', '/api/v1/auth/sign-in'],
    ['post', '/api/v1/quotes'],
    ['post', '/api/v1/listing-drafts/{id}/photos/upload-url'],
    ['post', '/api/v1/listing-drafts/{id}/documents/{kind}/upload-url'],
    ['get', '/api/v1/search/garages'],
    ['post', '/api/v1/push-subscriptions/test'],
  ])('%s %s documents a 429 rate_limited', (method, path) => {
    const refusal = document.paths[path]?.[method]?.responses?.['429'];
    expect(refusal?.description).toMatch(/^rate_limited\b/);
  });
});
