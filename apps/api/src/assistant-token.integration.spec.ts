import { PRISMA } from '@motor-fix/domain/testing';
import { generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';

import { apiBoot } from './api-boot.testing';

const api = apiBoot();

afterAll(() => api.stop());

// An assistant's token is bound to the MCP server; even with the claims a
// session token carries it opens nothing on the API.
// @traces 365-FR-003
describe('an assistant token sent to the API', () => {
  it('is refused as no session', async () => {
    const app = await api.start();
    const prisma = app.get<{
      account: { create(args: object): Promise<{ id: string }> };
    }>(PRISMA);
    const { id } = await prisma.account.create({
      data: {
        lastRole: 'driver',
        name: 'Radu Stan',
        roles: { create: [{ role: 'driver' }] },
      },
    });
    const { privateKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({
      aud: 'http://127.0.0.1:3002/mcp',
      azp: 'https://claude.ai/oauth/mcp-client',
      motorfix_account_id: id,
      role: 'driver',
      scope: 'motorfix.read motorfix.act',
      sub: id,
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  }, 240_000);
});
