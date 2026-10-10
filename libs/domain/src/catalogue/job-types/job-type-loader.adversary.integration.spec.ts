import { JobTypeLoader } from './job-type-loader';
import { JOB_TYPES, type JobTypeRecord } from './job-types';
import type { AuditPort } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma } = fixtures();
const loader = new JobTypeLoader(prisma, new AuditService());
serialDatabase(databaseUrl);

let since: Date;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE job_type, garage CASCADE');
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const history = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { at: { gte: since }, subjectType: 'job_type' },
  });

const count = () => prisma.jobType.count();

describe('JobTypeLoader under hostile files and failures', () => {
  it('loads an empty file as a no-op and removes nothing', async () => {
    await loader.load(JOB_TYPES);

    const result = await loader.load([]);

    expect(result.changed).toBe(0);
    expect(await count()).toBe(6);
    expect(await history()).toHaveLength(6);
  });

  it('loads an empty file into an empty catalogue', async () => {
    expect((await loader.load([])).changed).toBe(0);
    expect(await count()).toBe(0);
  });

  it('keeps Romanian diacritics and emoji exactly as written', async () => {
    const name = 'Încărcare ștergătoare și țevi 🚗 – ΑΒΓ';
    await loader.load([{ key: 'wipers', nameEn: 'Wipers', nameRo: name }]);

    const row = await prisma.jobType.findUniqueOrThrow({
      where: { key: 'wipers' },
    });
    expect(row.nameRo).toBe(name);
  });

  it('treats keys that differ only in case as different jobs', async () => {
    await loader.load([
      { key: 'Brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
      { key: 'brakes', nameEn: 'Brakes 2', nameRo: 'Frâne 2' },
    ]);

    expect(await count()).toBe(2);
  });

  it('stores a very long name whole', async () => {
    const long = 'x'.repeat(10_000);
    await loader.load([{ key: 'long', nameEn: long, nameRo: `${long}r` }]);

    const row = await prisma.jobType.findUniqueOrThrow({
      where: { key: 'long' },
    });
    expect(row.nameEn).toHaveLength(10_000);
  });

  it('records a rename of both names as two updates and counts the job once', async () => {
    await loader.load(JOB_TYPES);
    const before = (await history()).length;

    const result = await loader.load([
      { ...JOB_TYPES[1], nameEn: 'Oil', nameRo: 'Ulei' },
      ...JOB_TYPES.filter((_, i) => i !== 1),
    ]);

    expect(result.changed).toBe(1);
    const updates = (await history())
      .slice(before)
      .map((e) => [e.action, e.field]);
    expect(updates.sort()).toEqual([
      ['update', 'nameEn'],
      ['update', 'nameRo'],
    ]);
  });

  it('writes nothing when a name is renamed and renamed back to the original', async () => {
    await loader.load(JOB_TYPES);
    await loader.load([{ ...JOB_TYPES[0], nameEn: 'Temp' }]);
    const before = await history();

    const result = await loader.load(JOB_TYPES);
    expect(result.changed).toBe(1);
    const again = await loader.load(JOB_TYPES);

    expect(again.changed).toBe(0);
    expect((await history()).length).toBe(before.length + 1);
  });

  it('rolls the whole load back when a name holds a NUL byte at the end of the file', async () => {
    const records: JobTypeRecord[] = [
      ...JOB_TYPES,
      { key: 'bad', nameEn: 'Bad\u0000', nameRo: 'Rau' },
    ];

    await expect(loader.load(records)).rejects.toThrow();

    expect(await count()).toBe(0);
    expect(await history()).toEqual([]);
  });

  it('rolls back created rows when the audit write fails part-way', async () => {
    let calls = 0;
    const real = new AuditService();
    const flaky: AuditPort = {
      record: async (...args) => {
        calls += 1;
        if (calls === 4) throw new Error('audit down');
        return real.record(...args);
      },
      recordChanges: (...args) => real.recordChanges(...args),
      recordMany: (...args) => real.recordMany(...args),
    } as AuditPort;

    await expect(
      new JobTypeLoader(prisma, flaky).load(JOB_TYPES),
    ).rejects.toThrow('audit down');

    expect(await count()).toBe(0);
    expect(await history()).toEqual([]);
  });

  it('leaves exactly six jobs and six entries when many starts load together', async () => {
    await Promise.all(Array.from({ length: 8 }, () => loader.load(JOB_TYPES)));

    expect(await count()).toBe(6);
    expect(await history()).toHaveLength(6);
  });

  it('does not touch the stored status, ids or timestamps of an unchanged file', async () => {
    await loader.load(JOB_TYPES);
    const before = await prisma.jobType.findMany({ orderBy: { key: 'asc' } });

    await loader.load([...JOB_TYPES].reverse());

    expect(await prisma.jobType.findMany({ orderBy: { key: 'asc' } })).toEqual(
      before,
    );
  });
});
