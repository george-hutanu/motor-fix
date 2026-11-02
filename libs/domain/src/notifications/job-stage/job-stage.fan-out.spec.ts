import { Logger } from '@nestjs/common';
import type { Mock } from 'vitest';

import { JOB_STAGE_CONSUMER, JobStageFanOut } from './job-stage.fan-out';
import type { PrismaClient } from '../../generated/prisma/client';
import type { EmailConfig } from '../email-config';
import type { NotificationsService } from '../notifications.service';

interface Row {
  status: string;
  driverId: string;
  garageId: string;
  mechanicId: string | null;
  mechanic: { name: string } | null;
  garage: { name: string };
  car: { model: string; brand: { name: string } };
  booking: { requestId: string };
  driver: { language: string };
}

const row = (over: Partial<Row> = {}): Row => ({
  booking: { requestId: 'r-1' },
  car: { brand: { name: 'Dacia' }, model: 'Logan' },
  driver: { language: 'ro' },
  driverId: 'd-1',
  garage: { name: 'Garaj Nordic' },
  garageId: 'g-1',
  mechanic: { name: 'Mihai Popescu' },
  mechanicId: 'm-1',
  status: 'in_work',
  ...over,
});

function setup(job: Row | null | Error, teamMechanics = true) {
  const findUnique = vi.fn(async () => {
    if (job instanceof Error) throw job;
    return job;
  });
  const prisma = {
    garageFeature: {
      findUnique: vi.fn(async () => ({ enabled: teamMechanics })),
    },
    job: { findUnique },
  } as unknown as PrismaClient;
  const notify = vi.fn(async () => 1);
  const fanOut = new JobStageFanOut(
    prisma,
    { notify } as unknown as NotificationsService,
    { webUrl: 'https://motorfix.test' } as EmailConfig,
  );
  return { fanOut, notify };
}

const event = (kind: 'job.started' | 'job.done') => ({
  data: { id: '42', kind, payload: {}, subjectId: 'j-1' },
});

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

// @traces 277-FR-003
// @traces 277-FR-004
describe('telling the driver the car is ready', () => {
  it('listens to job.started and job.done only, on its own queue', () => {
    expect(JOB_STAGE_CONSUMER.kinds).toEqual(['job.started', 'job.done']);
    expect(JOB_STAGE_CONSUMER.queue).toBe('job-stage');
  });

  it('builds one JOB_READY for the driver, naming the garage and linking the tracker', async () => {
    const { fanOut, notify } = setup(row({ status: 'done' }));

    await fanOut.handle(event('job.done'));

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      eventId: '42',
      kind: 'JOB_READY',
      params: {
        garage: 'Garaj Nordic',
        link: 'https://motorfix.test/app/driver/requests/r-1',
      },
      recipients: ['d-1'],
      subjectId: 'j-1',
    });
  });

  it('says nothing once the job was reopened, or is gone', async () => {
    for (const job of [row({ status: 'in_work' }), null]) {
      const { fanOut, notify } = setup(job);
      await fanOut.handle(event('job.done'));
      expect(notify).not.toHaveBeenCalled();
    }
  });

  it('lets a failed read fail the run, so the queue retries it', async () => {
    const { fanOut, notify } = setup(new Error('connection lost'));

    await expect(fanOut.handle(event('job.done'))).rejects.toThrow(
      'connection lost',
    );
    expect(notify).not.toHaveBeenCalled();
  });
});

// @traces 277-FR-001
// @traces 277-FR-004
describe('telling the driver work has started', () => {
  const started = async (job: Row | null, teamMechanics = true) => {
    const { fanOut, notify } = setup(job, teamMechanics);
    await fanOut.handle(event('job.started'));
    return notify;
  };
  const params = (notify: Mock) =>
    (notify.mock.calls[0] as unknown as [{ params: object }])[0].params;

  it('names the mechanic by first name and the car by brand and model', async () => {
    const notify = await started(row());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]).toEqual([
      {
        eventId: '42',
        kind: 'JOB_STARTED',
        params: {
          actor: 'Mihai',
          car: 'Dacia Logan',
          link: 'https://motorfix.test/app/driver/requests/r-1',
        },
        recipients: ['d-1'],
        subjectId: 'j-1',
      },
    ]);
  });

  it('names the garage when the team is off, no mechanic is set or the name is blank', async () => {
    expect(params(await started(row(), false))).toMatchObject({
      actor: 'Garaj Nordic',
    });
    expect(
      params(await started(row({ mechanic: null, mechanicId: null }))),
    ).toMatchObject({ actor: 'Garaj Nordic' });
    expect(
      params(await started(row({ mechanic: { name: '  ' } }))),
    ).toMatchObject({ actor: 'Garaj Nordic' });
    expect(
      params(await started(row({ mechanic: { name: 'Mihai' } }))),
    ).toMatchObject({ actor: 'Mihai' });
  });

  it('builds the car phrase in the driver language, never with the plate', async () => {
    const en = row({ driver: { language: 'en' } });
    expect(params(await started(en))).toMatchObject({
      car: 'the Dacia Logan',
    });
    expect(
      params(
        await started({
          ...en,
          car: { brand: { name: 'Dacia' }, model: ' ' },
        }),
      ),
    ).toMatchObject({ car: 'the Dacia' });
    expect(
      params(await started({ ...en, car: { brand: { name: '' }, model: '' } })),
    ).toMatchObject({ car: 'your car' });
    expect(
      params(await started(row({ car: { brand: { name: '' }, model: '' } }))),
    ).toMatchObject({ car: 'mașina ta' });
  });

  it('says nothing for a cancelled or missing job', async () => {
    expect(await started(row({ status: 'cancelled' }))).not.toHaveBeenCalled();
    expect(await started(null)).not.toHaveBeenCalled();
  });
});
