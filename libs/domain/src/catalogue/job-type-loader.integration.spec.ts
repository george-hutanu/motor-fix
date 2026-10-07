import { JobTypeLoader } from './job-type-loader';
import { JOB_TYPES, JobTypeFileError, type JobTypeRecord } from './job-types';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { prisma } = fixtures();
const loader = new JobTypeLoader(prisma, new AuditService());
serialDatabase(databaseUrl);

// The history is append-only: each test reads the entries written since it began.
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

const stored = () =>
  prisma.jobType.findMany({
    orderBy: { key: 'asc' },
    select: { id: true, key: true, nameEn: true, nameRo: true, status: true },
  });

const history = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { at: { gte: since }, subjectType: 'job_type' },
  });

describe('the job catalogue file', () => {
  it('holds the six jobs of the listing wizard, named in Romanian and English', () => {
    expect(JOB_TYPES).toEqual([
      {
        key: 'diagnosis',
        nameEn: 'Diagnosis and fault-code read',
        nameRo: 'Diagnoză și citire coduri de eroare',
      },
      {
        key: 'oil-service',
        nameEn: 'Oil and filter service',
        nameRo: 'Schimb de ulei și filtre',
      },
      {
        key: 'front-brakes',
        nameEn: 'Front brake pads and discs',
        nameRo: 'Plăcuțe și discuri de frână față',
      },
      {
        key: 'timing-chain',
        nameEn: 'Timing chain kit',
        nameRo: 'Kit lanț de distribuție',
      },
      {
        key: 'ac-regas',
        nameEn: 'Air-con regas',
        nameRo: 'Încărcare freon climă',
      },
      {
        key: 'suspension-alignment',
        nameEn: 'Suspension check and alignment',
        nameRo: 'Verificare suspensie și geometrie',
      },
    ]);
  });
});

describe('JobTypeLoader', () => {
  it('stores the six jobs once, approved, with both names', async () => {
    const result = await loader.load(JOB_TYPES);

    expect(result.changed).toBe(6);
    const rows = await stored();
    expect(rows).toHaveLength(6);
    for (const job of JOB_TYPES) {
      expect(rows).toContainEqual(
        expect.objectContaining({ ...job, status: 'approved' }),
      );
    }
  });

  it('records each created job in the history as the system', async () => {
    await loader.load(JOB_TYPES);

    const entries = await history();
    expect(entries).toHaveLength(6);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        action: 'create',
        actorId: null,
        actorRole: 'system',
        garageId: null,
      });
    }
  });

  it('changes nothing and records nothing when the same file runs again', async () => {
    await loader.load(JOB_TYPES);
    const before = await prisma.jobType.findMany({ orderBy: { key: 'asc' } });
    const entries = (await history()).length;

    const result = await loader.load(JOB_TYPES);

    expect(result.changed).toBe(0);
    expect(await prisma.jobType.findMany({ orderBy: { key: 'asc' } })).toEqual(
      before,
    );
    expect(await history()).toHaveLength(entries);
  });

  it('keeps the id of a renamed job and records the new name', async () => {
    await loader.load(JOB_TYPES);
    const diagnosis = await prisma.jobType.findUniqueOrThrow({
      where: { key: 'diagnosis' },
    });

    const result = await loader.load([
      { ...JOB_TYPES[0], nameEn: 'Diagnosis' },
      ...JOB_TYPES.slice(1),
    ]);

    expect(result.changed).toBe(1);
    expect(
      await prisma.jobType.findUniqueOrThrow({ where: { key: 'diagnosis' } }),
    ).toMatchObject({ id: diagnosis.id, nameEn: 'Diagnosis' });
    expect(
      (await history()).filter((entry) => entry.action === 'update'),
    ).toEqual([
      expect.objectContaining({
        actorRole: 'system',
        field: 'nameEn',
        newValue: 'Diagnosis',
        oldValue: 'Diagnosis and fault-code read',
        subjectId: diagnosis.id,
      }),
    ]);
  });

  it.each<[string, JobTypeRecord[]]>([
    [
      'a duplicate key',
      [
        { key: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
        { key: 'brakes', nameEn: 'Rear brakes', nameRo: 'Frâne spate' },
      ],
    ],
    [
      'a duplicate name',
      [
        { key: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
        { key: 'rear-brakes', nameEn: 'Brakes', nameRo: 'Frâne spate' },
      ],
    ],
    ['a blank key', [{ key: ' ', nameEn: 'Brakes', nameRo: 'Frâne' }]],
    ['a blank name', [{ key: 'brakes', nameEn: 'Brakes', nameRo: '' }]],
  ])('refuses a file with %s and stores nothing', async (_, records) => {
    await loader.load(JOB_TYPES);
    const before = await stored();
    const entries = (await history()).length;

    await expect(loader.load(records)).rejects.toThrow(JobTypeFileError);
    expect(await stored()).toEqual(before);
    expect(await history()).toHaveLength(entries);
  });

  it('stores each job once when two starts load together', async () => {
    await Promise.all([loader.load(JOB_TYPES), loader.load(JOB_TYPES)]);

    expect(await stored()).toHaveLength(6);
    expect(await history()).toHaveLength(6);
  });

  it('leaves a stored job missing from the file as it is', async () => {
    const extra = await prisma.jobType.create({
      data: {
        key: 'tyre-change',
        nameEn: 'Tyre change',
        nameRo: 'Schimb anvelope',
        status: 'pending',
      },
    });

    await loader.load(JOB_TYPES);

    expect(
      await prisma.jobType.findUniqueOrThrow({ where: { id: extra.id } }),
    ).toEqual(extra);
  });

  it('keeps the status of a stored job the file names', async () => {
    await prisma.jobType.create({
      data: { ...JOB_TYPES[3], status: 'rejected' },
    });

    const result = await loader.load(JOB_TYPES);

    expect(result.changed).toBe(5);
    expect(
      await prisma.jobType.findUniqueOrThrow({
        where: { key: JOB_TYPES[3].key },
      }),
    ).toMatchObject({ status: 'rejected' });
  });

  it('stores a new job as pending unless the loader approves it', async () => {
    const job = await prisma.jobType.create({
      data: { key: 'tyre-change', nameEn: 'Tyre change', nameRo: 'Anvelope' },
    });

    expect(job).toMatchObject({
      carSystem: null,
      rarActivity: null,
      status: 'pending',
    });
  });
});
