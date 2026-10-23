import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import type { Role } from '../../../auth/capabilities';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { NotificationsModule } from '../../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../../storage/s3-test-store';
import { StorageModule } from '../../../storage/storage.module';
import { GaragesModule } from '../../garages.module';

const tokenSecret = 'test-secret';

export type Kind = 'onrc_certificate' | 'rar_authorisation';

// The API as the application wires the admin's decision routes: a session on
// every route and the edge's validation.
export function documentReviewApi() {
  const { account, prisma, reset } = fixtures();
  serialDatabase(databaseUrl);
  const holder: { app?: NestExpressApplication } = {};

  beforeAll(async () => {
    const redisUrl = redisUrlFor(3);
    const email = testConfig('http://127.0.0.1:9');
    const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
    const notifications = NotificationsModule.register(
      { databaseUrl, email, redisUrl },
      auth,
    );
    const moduleRef = await Test.createTestingModule({
      imports: [
        auth,
        notifications,
        StorageModule.register(UNUSED_STORAGE),
        GaragesModule.register(email, notifications, {
          skipManualApproval: false,
        }),
      ],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
    holder.app = app;
  });

  afterAll(async () => {
    await holder.app?.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await reset();
  });

  const http = () => {
    if (!holder.app) throw new Error('the app is not up');
    return request(holder.app.getHttpServer());
  };

  const bearer = (accountId: string, role: Role) =>
    `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

  // Atelier Dinamo, approved on 1 November 2025 with its listing's two valid
  // documents, its cycle due on 1 November 2026 and reset at its approval,
  // and a yearly upload of each kind waiting for an admin; its owner Radu, the
  // admin Ana and a driver.
  async function world(
    cycle: Partial<{
      dueOn: string;
      graceUntil: string;
      state: 'due' | 'overdue';
    }> = {},
  ) {
    const dinamo = await prisma.garage.create({
      data: {
        approvedAt: new Date('2025-11-01T09:00:00Z'),
        name: 'ATELIER DINAMO SRL',
        slug: `dinamo-${randomUUID()}`,
        status: 'approved',
      },
    });
    const file = await prisma.verificationFile.create({
      data: { garageId: dinamo.id, status: 'approved' },
    });
    const listed = (kind: Kind) =>
      prisma.legalDocument.create({
        data: {
          createdAt: new Date('2025-10-30T09:00:00Z'),
          kind,
          pages: [`legal_document/${dinamo.id}/old-${kind}`],
          verificationFileId: file.id,
        },
      });
    const uploaded = (kind: Kind, createdAt: string) =>
      prisma.legalDocument.create({
        data: {
          createdAt: new Date(createdAt),
          issuedOn: new Date('2026-10-20'),
          kind,
          pages: [`legal_document/${dinamo.id}/new-${kind}`],
          status: 'in_review',
          verificationFileId: file.id,
        },
      });
    const old = {
      onrc_certificate: await listed('onrc_certificate'),
      rar_authorisation: await listed('rar_authorisation'),
    };
    const fresh = {
      onrc_certificate: await uploaded(
        'onrc_certificate',
        '2026-10-21T08:00:00Z',
      ),
      rar_authorisation: await uploaded(
        'rar_authorisation',
        '2026-10-21T08:00:01Z',
      ),
    };
    const documentCycle = await prisma.documentCycle.create({
      data: {
        dueOn: new Date(cycle.dueOn ?? '2026-11-01'),
        garageId: dinamo.id,
        graceUntil: cycle.graceUntil ? new Date(cycle.graceUntil) : null,
        reminded30At: new Date('2026-10-02T06:00:00Z'),
        resetAt: new Date('2025-11-01T09:00:00Z'),
        state: cycle.state ?? 'due',
      },
    });
    const radu = await account('radu', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: radu, garageId: dinamo.id, role: 'owner' },
    });
    const ana = await account('ana', ['admin']);
    const sofer = await account('sofer', ['driver']);
    return {
      admin: bearer(ana, 'admin'),
      ana,
      cycle: documentCycle,
      dinamo,
      driver: bearer(sofer, 'driver'),
      file,
      fresh,
      old,
      owner: bearer(radu, 'garage'),
    };
  }

  const accept = (id: string, as: string) =>
    http()
      .post(`/admin/legal-documents/${id}/accept`)
      .set('Authorization', as)
      .send();

  const refuse = (id: string, as: string, body: object) =>
    http()
      .post(`/admin/legal-documents/${id}/refuse`)
      .set('Authorization', as)
      .send(body);

  return { accept, http, prisma, refuse, world };
}

export const day = (at: Date | null) =>
  at ? at.toISOString().slice(0, 10) : null;
