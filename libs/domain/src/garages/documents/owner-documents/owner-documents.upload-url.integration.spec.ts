import { randomUUID } from 'node:crypto';

import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';

import { OwnerDocumentsController } from './owner-documents.controller';
import { MB, ownerDocumentsApi } from './owner-documents.testing';
import { NoStore } from '../../listing-drafts/listing-drafts.controller';

const { http, prisma, uploadUrl, world } = ownerDocumentsApi(8);

// @traces 068-FR-006
describe('the yearly documents upload address', () => {
  it('is signed for the owner under the garage, for the legal_document purpose', async () => {
    const { dinamo, owner } = await world();
    const before = Date.now();

    const answer = await uploadUrl(dinamo.id, owner);

    expect(answer.status).toBe(201);
    expect(answer.body.key).toMatch(
      new RegExp(`^incoming/legal_document/${dinamo.id}/[0-9a-f-]{36}$`),
    );
    expect(answer.body.headers).toMatchObject({
      'Content-Type': 'application/pdf',
    });
    const minutes = (Date.parse(answer.body.expiresAt) - before) / 60_000;
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThanOrEqual(15.1);
  });

  it('answers with Cache-Control: no-store', () => {
    expect(
      Reflect.getMetadata(INTERCEPTORS_METADATA, OwnerDocumentsController),
    ).toContain(NoStore);
  });

  it('works for a suspended garage too', async () => {
    const { dinamo, owner } = await world({ status: 'suspended' });
    expect((await uploadUrl(dinamo.id, owner)).status).toBe(201);
  });

  it.each(['receptionist', 'mechanic'] as const)(
    "refuses the garage's %s with not_owner",
    async (who) => {
      const people = await world();

      const answer = await uploadUrl(people.dinamo.id, people[who]);

      expect(answer.status).toBe(403);
      expect(answer.body).toMatchObject({ code: 'not_owner' });
    },
  );

  it.each(['other', 'driver', 'admin'] as const)(
    'answers 404 to %s',
    async (who) => {
      const people = await world();
      expect((await uploadUrl(people.dinamo.id, people[who])).status).toBe(404);
    },
  );

  it('answers 404 for a draft garage, an unknown one and a malformed id', async () => {
    const { dinamo, owner } = await world({ status: 'draft' });
    expect((await uploadUrl(dinamo.id, owner)).status).toBe(404);
    expect((await uploadUrl(randomUUID(), owner)).status).toBe(404);
    expect((await uploadUrl('not-an-id', owner)).status).toBe(404);
  });

  it('asks for a session', async () => {
    const { dinamo } = await world();
    const answer = await http()
      .post(`/garages/${dinamo.id}/legal-documents/upload-url`)
      .send({ checksum: 'yPQ5Jg==', contentType: 'application/pdf', size: 1 });
    expect(answer.status).toBe(401);
  });

  it('refuses another upload while both yearly documents wait for an admin', async () => {
    const { dinamo, file, owner } = await world();
    const waiting = (kind: 'onrc_certificate' | 'rar_authorisation') =>
      prisma.legalDocument.create({
        data: {
          kind,
          pages: [`legal_document/x/${kind}`],
          status: 'in_review',
          verificationFileId: file.id,
        },
      });
    await waiting('rar_authorisation');
    expect((await uploadUrl(dinamo.id, owner)).status).toBe(201);
    await waiting('onrc_certificate');

    const answer = await uploadUrl(dinamo.id, owner);

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'document_in_review' });
  });

  it.each([
    ['a .docx', 'application/msword', 100, 'file_type_not_allowed'],
    ['a 14 MB PDF', 'application/pdf', 14 * MB, 'file_too_large'],
  ])('refuses %s with a stable code', async (_, contentType, size, code) => {
    const { dinamo, owner } = await world();

    const answer = await uploadUrl(dinamo.id, owner, {
      checksum: 'yPQ5Jg==',
      contentType,
      size,
    });

    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ code });
  });

  // @traces 068-FR-017
  it('is limited to 60 addresses an hour per garage, as the listing uploads are', async () => {
    const { dinamo, owner } = await world();
    for (let n = 0; n < 60; n += 1) {
      expect((await uploadUrl(dinamo.id, owner)).status).toBe(201);
    }

    const answer = await uploadUrl(dinamo.id, owner);

    expect(answer.status).toBe(429);
    expect(answer.body).toMatchObject({ code: 'rate_limited' });
  });
});
