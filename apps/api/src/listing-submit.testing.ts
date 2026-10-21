import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { CURRENT_CONSENT, type ListingDraftData } from '@motor-fix/contracts';
import { AccountsService, PRISMA, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { TEST_TOKEN_SECRET } from './api-boot.testing';

const CUI_KEY = [7, 5, 3, 2, 1, 7, 5, 3, 2];

// A CUI of its own whose control digit is right.
function freshCui() {
  const body = String(1_000_000 + Math.floor(Math.random() * 8_999_999));
  const digits = body.padStart(CUI_KEY.length, '0');
  const sum = CUI_KEY.reduce((total, w, i) => total + w * +digits[i], 0);
  return `${body}${((sum * 10) % 11) % 10}`;
}

const PAGE = 'listing-documents/3f1b7d2a-6a43-4c55-9d1c-6f3f1b7d2a10/p1';
const PHOTO = 'garage-photos/3f1b7d2a-6a43-4c55-9d1c-6f3f1b7d2a10/p1';

// A complete draft of its own, its brand and catalogue job made for it, and
// the browser key that opens it.
export async function completeDraft(
  app: INestApplication,
  change: (data: ListingDraftData) => void = () => undefined,
) {
  const prisma = app.get(PRISMA);
  const tag = randomUUID().slice(0, 8);
  const brand = await prisma.brand.create({
    data: { key: `b-${tag}`, name: `Marca ${tag}`, slug: `marca-${tag}` },
  });
  const job = await prisma.jobType.create({
    data: {
      key: `j-${tag}`,
      nameEn: `Job ${tag}`,
      nameRo: `Lucrare ${tag}`,
      status: 'approved',
    },
  });
  const name = `Service ${tag}`;
  const data: ListingDraftData = {
    declaredAt: '2026-10-11T10:00:00.000Z',
    declaredByName: 'Ion Popescu',
    documents: {
      onrc_certificate: { pages: [PAGE] },
      rar_authorisation: { pages: [PAGE] },
    },
    files: [PHOTO.replace('p1', tag)],
    steps: {
      '1': {
        businessKind: 'company',
        knownFor: 'Frâne și distribuție',
        name,
        phone: '0722 123 456',
      },
      '2': {
        brands: [{ brandId: brand.id, name: brand.name, stance: 'works_on' }],
      },
      '3': {
        jobs: [{ fromBani: 15_000, jobTypeId: job.id, toBani: 30_000 }],
        labour: { fromBani: 12_000, toBani: 20_000 },
      },
      '4': {},
      '5': {
        payments: ['cash'],
        place: { address: 'Str. Lungă 1, Brașov', lat: 45.65, lng: 25.6 },
      },
      '6': { cui: freshCui(), rarNumber: 'BV-123' },
    },
    survey: {
      foundVia: 'google',
      liftsCount: '1',
      mechanicsCount: '1-2',
      wantsDaySheets: false,
      wantsLiveMedia: true,
    },
  };
  change(data);
  const token = randomBytes(32).toString('base64url');
  const draft = await prisma.listingDraft.create({
    data: {
      data: data as object,
      email: `owner-${tag}@example.test`,
      language: 'ro',
      step: 6,
      tokens: {
        create: {
          hash: createHash('sha256').update(token).digest('hex'),
          kind: 'browser',
          sentAt: new Date(),
        },
      },
      updatedAt: new Date(),
    },
  });
  return { brand, id: draft.id, name, token };
}

export async function signedIn(app: INestApplication, role = 'driver') {
  const { id } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `${role}-${randomUUID()}` },
    name: 'Ana Popescu',
    roles: [role as never],
  });
  return {
    accountId: id,
    bearer: `Bearer ${signAccessToken({ accountId: id, role } as never, TEST_TOKEN_SECRET, Date.now())}`,
  };
}

export const submit = (
  app: INestApplication,
  id: string,
  headers: Record<string, string>,
) => {
  const req = request(app.getHttpServer()).post(
    `/api/v1/listing-drafts/${id}/submit`,
  );
  for (const [name, value] of Object.entries(headers)) req.set(name, value);
  return req.send();
};
