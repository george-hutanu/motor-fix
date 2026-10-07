import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { NotificationsService } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { apiBoot } from './api-boot.testing';

const api = apiBoot();
const webUrl = process.env['PUBLIC_WEB_URL'];

let app: INestApplication;
let sent: jest.SpyInstance;

beforeAll(async () => {
  process.env['PUBLIC_WEB_URL'] = 'https://motorfix.test';
  sent = jest
    .spyOn(NotificationsService.prototype, 'sendAccountEmail')
    .mockResolvedValue(undefined);
  app = await api.start();
}, 120_000);

afterAll(async () => {
  try {
    await api.stop();
  } finally {
    sent.mockRestore();
    if (webUrl === undefined) delete process.env['PUBLIC_WEB_URL'];
    else process.env['PUBLIC_WEB_URL'] = webUrl;
  }
});

describe('signing up through the api', () => {
  it('sends the new address a confirmation link to the web app', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .send({
        consent: CURRENT_CONSENT,
        email: `confirm-${randomUUID()}@example.test`,
        language: 'en',
        name: 'Andrei Marin',
        password: 'o-parola-lunga',
      })
      .expect(201);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      link: expect.stringMatching(
        /^https:\/\/motorfix\.test\/en\/confirm-email\/[A-Za-z0-9_-]{43}$/,
      ),
      purpose: 'email_check',
    });
  });
});
