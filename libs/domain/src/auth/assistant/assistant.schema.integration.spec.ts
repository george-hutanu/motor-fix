// @traces 365-FR-004 365-FR-013
import { createHash, randomUUID } from 'node:crypto';

import { createPrisma } from '../prisma';
import { serialDatabase } from '../serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

const account = () =>
  prisma.account.create({
    data: { lastRole: 'driver', name: 'Andrei Ionescu' },
  });

const grant = (accountId: string, clientId = 'https://claude.ai/oauth') =>
  prisma.assistantGrant.create({
    data: {
      accountId,
      canAct: false,
      canRead: true,
      clientId,
      clientName: 'claude.ai',
    },
  });

const signInCode = (accountId: string, codeHash = hashOf(randomUUID())) =>
  prisma.assistantSignInCode.create({
    data: {
      accountId,
      clientId: 'motorfix-broker',
      codeHash,
      expiresAt: new Date(Date.now() + 60_000),
      nonce: randomUUID(),
      redirectUri: 'https://id.motorfix.example/broker/motorfix/endpoint',
    },
  });

const hashOf = (code: string) =>
  createHash('sha256').update(code).digest('hex');

describe('assistant_grant', () => {
  it('starts live, used now, with no revocation', async () => {
    const { id } = await account();

    const created = await grant(id);

    expect(created).toMatchObject({
      accountId: id,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.lastUsedAt).toBeInstanceOf(Date);
  });

  it('holds one grant per account and assistant client', async () => {
    const { id } = await account();
    await grant(id);

    await expect(grant(id)).rejects.toMatchObject({ code: 'P2002' });
    await expect(grant(id, 'https://chatgpt.com/oauth')).resolves.toBeTruthy();
  });

  it('lets two accounts connect the same assistant client', async () => {
    const [first, second] = [await account(), await account()];

    await grant(first.id);

    await expect(grant(second.id)).resolves.toBeTruthy();
  });

  it('goes with the account', async () => {
    const { id } = await account();
    await grant(id);

    await prisma.account.delete({ where: { id } });

    expect(
      await prisma.assistantGrant.count({ where: { accountId: id } }),
    ).toBe(0);
  });
});

describe('assistant_sign_in_code', () => {
  it('stores one row per code hash', async () => {
    const { id } = await account();
    const codeHash = hashOf(randomUUID());
    await signInCode(id, codeHash);

    await expect(signInCode(id, codeHash)).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('starts unused', async () => {
    const { id } = await account();

    expect(await signInCode(id)).toMatchObject({ usedAt: null });
  });

  it('goes with the account', async () => {
    const { id } = await account();
    await signInCode(id);

    await prisma.account.delete({ where: { id } });

    expect(
      await prisma.assistantSignInCode.count({ where: { accountId: id } }),
    ).toBe(0);
  });
});
