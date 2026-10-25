import { databaseUrl, fixtures } from './notifications.testing';
import { SMS_PER_MONTH, smsUsed } from './sms-counter';
import { serialDatabase } from '../auth/serial-db.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

afterAll(() => prisma.$disconnect());
beforeEach(reset);

const count = (accountId: string, month: string, sentCount: number) =>
  prisma.smsCounter.create({ data: { accountId, month, sentCount } });

// @traces 142-FR-004
describe('the SMS used this month', () => {
  it('has the cap of five', () => {
    expect(SMS_PER_MONTH).toBe(5);
  });

  it('is 0 for an account with no counter row', async () => {
    const id = await account('none');
    expect(await smsUsed(prisma, id, new Date('2026-10-15T10:00:00Z'))).toBe(0);
  });

  it('is 0 for an account id that does not exist', async () => {
    expect(
      await smsUsed(prisma, '00000000-0000-4000-8000-000000000000', new Date()),
    ).toBe(0);
  });

  it('rejects an id that is not a UUID instead of answering 0', async () => {
    await expect(smsUsed(prisma, 'not-a-uuid', new Date())).rejects.toThrow();
  });

  it('rejects an invalid date', async () => {
    const id = await account('bad-date');
    await expect(smsUsed(prisma, id, new Date(Number.NaN))).rejects.toThrow(
      RangeError,
    );
  });

  it('turns over at 00:00 Bucharest on 1 November, 22:00 UTC', async () => {
    const id = await account('winter');
    await count(id, '2026-10', 5);
    expect(
      await smsUsed(prisma, id, new Date('2026-10-31T21:59:59.999Z')),
    ).toBe(5);
    expect(
      await smsUsed(prisma, id, new Date('2026-10-31T22:00:00.000Z')),
    ).toBe(0);
  });

  it('turns over at 00:00 Bucharest on 1 July, 21:00 UTC', async () => {
    const id = await account('summer');
    await count(id, '2026-06', 4);
    await count(id, '2026-07', 2);
    expect(
      await smsUsed(prisma, id, new Date('2026-06-30T20:59:59.999Z')),
    ).toBe(4);
    expect(
      await smsUsed(prisma, id, new Date('2026-06-30T21:00:00.000Z')),
    ).toBe(2);
  });

  it('counts 31 December 23:30 UTC as January in Bucharest', async () => {
    const id = await account('newyear');
    await count(id, '2026-12', 3);
    await count(id, '2027-01', 1);
    expect(
      await smsUsed(prisma, id, new Date('2026-12-31T21:59:59.999Z')),
    ).toBe(3);
    expect(await smsUsed(prisma, id, new Date('2026-12-31T23:30:00Z'))).toBe(1);
  });

  it('reads only the account asked for', async () => {
    const mine = await account('mine');
    const theirs = await account('theirs');
    await count(theirs, '2026-10', 5);
    expect(await smsUsed(prisma, mine, new Date('2026-10-15T10:00:00Z'))).toBe(
      0,
    );
  });

  it('gives the same answer when asked twice and does not write', async () => {
    const id = await account('twice');
    await count(id, '2026-10', 2);
    const at = new Date('2026-10-15T10:00:00Z');
    expect([
      await smsUsed(prisma, id, at),
      await smsUsed(prisma, id, at),
    ]).toEqual([2, 2]);
    expect(await prisma.smsCounter.count({ where: { accountId: id } })).toBe(1);
  });
});
