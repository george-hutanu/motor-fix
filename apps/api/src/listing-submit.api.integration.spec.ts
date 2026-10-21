import { PRISMA } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';

import { apiBoot } from './api-boot.testing';
import { openApiDocument } from './bootstrap';
import { completeDraft, signedIn, submit } from './listing-submit.testing';

const api = apiBoot();
let app: INestApplication;

beforeAll(async () => {
  app = await api.start();
}, 120_000);

afterAll(() => api.stop());

const garagesOf = (accountId: string) =>
  app.get(PRISMA).garageMember.count({ where: { accountId } });

// @traces 116-FR-006
describe('POST /listing-drafts/:id/submit', () => {
  it('turns the draft into a garage and its submitted file for a signed-in caller', async () => {
    const { accountId, bearer } = await signedIn(app);
    const { id, token } = await completeDraft(app);

    const res = await submit(app, id, {
      Authorization: bearer,
      'Idempotency-Key': 'send-1',
      'X-Listing-Token': token,
    }).expect(201);

    expect(res.body).toEqual({
      fileId: expect.any(String),
      garageId: expect.any(String),
      status: 'submitted',
      warnings: [],
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await garagesOf(accountId)).toBe(1);
  });

  it('asks for a session first: 401 without one, nothing created', async () => {
    const { id, token } = await completeDraft(app);

    const res = await submit(app, id, {
      'Idempotency-Key': 'send-1',
      'X-Listing-Token': token,
    }).expect(401);

    expect(res.body.code).toBe('sign_in_required');
    expect(
      await app.get(PRISMA).listingDraft.findUnique({ where: { id } }),
    ).toMatchObject({ status: 'open' });
  });

  it('refuses a missing or overlong key with 400', async () => {
    const { bearer } = await signedIn(app);
    const { id, token } = await completeDraft(app);

    for (const key of [undefined, 'k'.repeat(65)]) {
      const res = await submit(app, id, {
        Authorization: bearer,
        'X-Listing-Token': token,
        ...(key && { 'Idempotency-Key': key }),
      }).expect(400);
      expect(res.body).toMatchObject({
        code: 'validation_failed',
        errors: [{ code: 'required', field: 'idempotency-key' }],
      });
    }
  });

  it('answers 404 draft_not_found to a wrong draft key or another draft’s id', async () => {
    const { bearer } = await signedIn(app);
    const mine = await completeDraft(app);
    const other = await completeDraft(app);

    for (const [id, token] of [
      [mine.id, 'x'.repeat(43)],
      [other.id, mine.token],
    ]) {
      const res = await submit(app, id, {
        Authorization: bearer,
        'Idempotency-Key': 'send-1',
        'X-Listing-Token': token,
      }).expect(404);
      expect(res.body.code).toBe('draft_not_found');
    }
  });

  // @traces 116-FR-008
  it('answers the same body to the same key, and 409 to another', async () => {
    const { bearer } = await signedIn(app);
    const { id, token } = await completeDraft(app);
    const headers = { Authorization: bearer, 'X-Listing-Token': token };

    const first = await submit(app, id, {
      ...headers,
      'Idempotency-Key': 'send-1',
    }).expect(201);
    const again = await submit(app, id, {
      ...headers,
      'Idempotency-Key': 'send-1',
    }).expect(201);
    const other = await submit(app, id, {
      ...headers,
      'Idempotency-Key': 'send-2',
    }).expect(409);

    expect(again.body).toEqual(first.body);
    expect(other.body.code).toBe('draft_already_submitted');
  });

  // @traces 116-FR-007
  it('answers 422 with the fields still missing', async () => {
    const { bearer } = await signedIn(app);
    const { id, token } = await completeDraft(app, (data) => {
      delete data.steps?.['6']?.rarNumber;
    });

    const res = await submit(app, id, {
      Authorization: bearer,
      'Idempotency-Key': 'send-1',
      'X-Listing-Token': token,
    }).expect(422);

    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'required', field: 'steps.6.rarNumber' }],
    });
    expect(res.body.warnings ?? []).toEqual([]);
  });

  // @traces 116-FR-009
  it('refuses an account that owns a garage with 409 garage_already_exists', async () => {
    const { bearer } = await signedIn(app);
    const first = await completeDraft(app);
    const second = await completeDraft(app);
    await submit(app, first.id, {
      Authorization: bearer,
      'Idempotency-Key': 'send-1',
      'X-Listing-Token': first.token,
    }).expect(201);

    const res = await submit(app, second.id, {
      Authorization: bearer,
      'Idempotency-Key': 'send-1',
      'X-Listing-Token': second.token,
    }).expect(409);

    expect(res.body.code).toBe('garage_already_exists');
  });

  // @traces 116-FR-018
  it('is in the published contract, session and both headers required', () => {
    const operation = (openApiDocument(app) as any).paths[
      '/api/v1/listing-drafts/{id}/submit'
    ]?.post;

    expect(operation?.operationId).toBeDefined();
    expect(
      operation.parameters
        .filter((p: { in: string }) => p.in === 'header')
        .map((p: { name: string; required: boolean }) => [p.name, p.required]),
    ).toEqual(
      expect.arrayContaining([
        ['Idempotency-Key', true],
        ['x-listing-token', true],
      ]),
    );
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['201', '400', '401', '404', '409', '422']),
    );
  });
});
