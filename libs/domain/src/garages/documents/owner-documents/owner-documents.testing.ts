import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { OwnerDocumentsModule } from './owner-documents.module';
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
import { S3TestStore } from '../../../storage/s3-test-store';
import { StorageModule } from '../../../storage/storage.module';
import { GaragesModule } from '../../garages.module';

export const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
export const MB = 1024 * 1024;

export const checksumOf = (file: Buffer) => {
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(file));
  return sum.toString('base64');
};

const tokenSecret = 'test-secret';

// The API as the application wires the owner's routes: a session on every
// route, the edge's validation, and an object store of the spec's own.
export function ownerDocumentsApi(redisDb: number) {
  const { account, prisma, reset } = fixtures();
  serialDatabase(databaseUrl);
  const store = new S3TestStore();
  const holder: { app?: NestExpressApplication } = {};

  beforeAll(async () => {
    await store.start();
    const redisUrl = redisUrlFor(redisDb);
    const email = testConfig('http://127.0.0.1:9');
    const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
    const notifications = NotificationsModule.register(
      { databaseUrl, email, redisUrl },
      auth,
    );
    const garages = GaragesModule.register(email, notifications, {
      skipManualApproval: false,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        auth,
        notifications,
        StorageModule.register(store.env()),
        garages,
        OwnerDocumentsModule.register(garages, notifications, email.webUrl),
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
    await store.stop();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await reset();
    store.objects.clear();
  });

  const http = () => {
    if (!holder.app) throw new Error('the app is not up');
    return request(holder.app.getHttpServer());
  };

  const bearer = (accountId: string, role: Role) =>
    `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

  // Atelier Dinamo, approved, with its listing's two documents on its file,
  // its cycle, its owner Radu, a receptionist and a mechanic; Service Auto
  // Nord with its owner Mihai; a driver; two active admins and a suspended one.
  async function world(
    garage: Partial<{ status: 'draft' | 'approved' | 'suspended' }> = {},
  ) {
    const dinamo = await prisma.garage.create({
      data: {
        approvedAt: new Date('2025-11-01T09:00:00Z'),
        name: 'ATELIER DINAMO SRL',
        slug: `dinamo-${randomUUID()}`,
        status: garage.status ?? 'approved',
      },
    });
    const file = await prisma.verificationFile.create({
      data: {
        documents: {
          create: [
            { kind: 'onrc_certificate', pages: ['legal_document/old/1'] },
            { kind: 'rar_authorisation', pages: ['legal_document/old/2'] },
          ],
        },
        garageId: dinamo.id,
        status: garage.status === 'draft' ? 'submitted' : 'approved',
      },
    });
    if (garage.status !== 'draft') {
      await prisma.documentCycle.create({
        data: {
          dueOn: new Date('2026-11-01'),
          garageId: dinamo.id,
          resetAt: new Date('2025-11-01T09:00:00Z'),
        },
      });
    }
    const nord = await prisma.garage.create({
      data: {
        name: 'Service Auto Nord',
        slug: `nord-${randomUUID()}`,
        status: 'approved',
      },
    });
    const radu = await account('radu', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: radu, garageId: dinamo.id, role: 'owner' },
    });
    const ioana = await account('ioana', ['receptionist']);
    await prisma.garageMember.create({
      data: { accountId: ioana, garageId: dinamo.id, role: 'receptionist' },
    });
    const vlad = await account('vlad', ['mechanic']);
    await prisma.mechanic.create({
      data: { accountId: vlad, garageId: dinamo.id, name: 'Mecanic' },
    });
    const mihai = await account('mihai', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: mihai, garageId: nord.id, role: 'owner' },
    });
    const sofer = await account('sofer', ['driver']);
    const ana = await account('ana', ['admin']);
    const dan = await account('dan', ['admin'], { language: 'en' });
    const gone = await account('gone', ['admin'], { status: 'suspended' });
    return {
      accounts: { ana, dan, gone, radu },
      admin: bearer(ana, 'admin'),
      dinamo,
      driver: bearer(sofer, 'driver'),
      file,
      mechanic: bearer(vlad, 'mechanic'),
      nord,
      other: bearer(mihai, 'garage'),
      owner: bearer(radu, 'garage'),
      receptionist: bearer(ioana, 'receptionist'),
    };
  }

  const uploadUrl = (
    garageId: string,
    as: string,
    body: object = {
      checksum: checksumOf(PDF),
      contentType: 'application/pdf',
      size: PDF.length,
    },
  ) =>
    http()
      .post(`/garages/${garageId}/legal-documents/upload-url`)
      .set('Authorization', as)
      .send(body);

  // A page the browser put through its signed address: the key to send.
  async function page(
    garageId: string,
    as: string,
    file = PDF,
    contentType = 'application/pdf',
  ): Promise<string> {
    const answer = await uploadUrl(garageId, as, {
      checksum: checksumOf(file),
      contentType,
      size: file.length,
    });
    expect(answer.status).toBe(201);
    const put = await fetch(answer.body.url, {
      body: new Uint8Array(file),
      headers: answer.body.headers,
      method: 'PUT',
    });
    expect(put.status).toBe(200);
    return answer.body.key;
  }

  const submit = (garageId: string, as: string, body: object) =>
    http()
      .post(`/garages/${garageId}/legal-documents`)
      .set('Authorization', as)
      .send(body);

  return { http, page, prisma, store, submit, uploadUrl, world };
}
