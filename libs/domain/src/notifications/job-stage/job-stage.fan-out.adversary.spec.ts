import { Logger } from '@nestjs/common';
import type { Mock, MockInstance } from 'vitest';

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

interface Opts {
  feature?: { enabled: boolean } | null | Error;
  notifyError?: Error;
  webUrl?: string;
}

function setup(job: Row | null | Error, opts: Opts = {}) {
  const prisma = {
    garageFeature: {
      findUnique: vi.fn(async () => {
        if (opts.feature instanceof Error) throw opts.feature;
        return opts.feature === undefined ? { enabled: true } : opts.feature;
      }),
    },
    job: {
      findUnique: vi.fn(async () => {
        if (job instanceof Error) throw job;
        return job;
      }),
    },
  } as unknown as PrismaClient;
  const notify = vi.fn(async () => {
    if (opts.notifyError) throw opts.notifyError;
    return 1;
  });
  const fanOut = new JobStageFanOut(
    prisma,
    { notify } as unknown as NotificationsService,
    { webUrl: opts.webUrl ?? 'https://motorfix.test' } as EmailConfig,
  );
  return { fanOut, notify, prisma };
}

const ev = (kind: string, id = '42', subjectId = 'j-1') =>
  ({ data: { id, kind, payload: {}, subjectId } }) as never;

const firstCall = (notify: Mock) =>
  (notify.mock.calls[0] as unknown as [Record<string, unknown>])[0];

let log: MockInstance;
beforeEach(() => {
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

// @traces 277-FR-003
describe('job stage fan-out: kinds and failures', () => {
  it.each(['job.paused', 'job.resumed', 'job.cancelled', '', 'JOB.DONE'])(
    'builds nothing for the kind %p',
    async (kind) => {
      const { fanOut, notify } = setup(row({ status: 'done' }));
      await fanOut.handle(ev(kind));
      expect(notify).not.toHaveBeenCalled();
    },
  );

  it('does not register the pause and resume kinds', () => {
    expect(JOB_STAGE_CONSUMER.kinds).not.toContain('job.paused');
    expect(JOB_STAGE_CONSUMER.kinds).not.toContain('job.resumed');
  });

  it('retries six times with a one minute exponential backoff', () => {
    expect(JOB_STAGE_CONSUMER.jobs).toEqual({
      attempts: 6,
      backoff: { delay: 60_000, type: 'exponential' },
      removeOnComplete: true,
      removeOnFail: true,
    });
  });

  it('lets a failing notify reject the run so the queue retries', async () => {
    const { fanOut } = setup(row({ status: 'done' }), {
      notifyError: new Error('redis down'),
    });
    await expect(fanOut.handle(ev('job.done'))).rejects.toThrow('redis down');
  });

  it('lets a failing feature read reject a started run', async () => {
    const { fanOut, notify } = setup(row(), {
      feature: new Error('feature read failed'),
    });
    await expect(fanOut.handle(ev('job.started'))).rejects.toThrow(
      'feature read failed',
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('lets a failing job read reject a started run', async () => {
    const { fanOut } = setup(new Error('boom'));
    await expect(fanOut.handle(ev('job.started'))).rejects.toThrow('boom');
  });
});

// @traces 277-FR-004
describe('job stage fan-out: job status', () => {
  it.each(['cancelled', 'in_work', 'paused', 'pending', 'DONE', ''])(
    'sends no JOB_READY while the status is %p',
    async (status) => {
      const { fanOut, notify } = setup(row({ status }));
      await fanOut.handle(ev('job.done'));
      expect(notify).not.toHaveBeenCalled();
    },
  );

  it.each(['in_work', 'paused', 'done'])(
    'still sends JOB_STARTED for a job that moved on to %p',
    async (status) => {
      const { fanOut, notify } = setup(row({ status }));
      await fanOut.handle(ev('job.started'));
      expect(notify).toHaveBeenCalledTimes(1);
    },
  );

  it('logs the job id for a skipped missing job', async () => {
    const { fanOut } = setup(null);
    await fanOut.handle(ev('job.started', '7', 'job-gone'));
    expect(JSON.stringify(log.mock.calls)).toContain('job-gone');
  });

  it('logs the job id for a told driver', async () => {
    const { fanOut } = setup(row({ status: 'done' }));
    await fanOut.handle(ev('job.done', '7', 'job-told'));
    expect(JSON.stringify(log.mock.calls)).toContain('job-told');
  });

  it('sends again for a genuine second job.started with another event id', async () => {
    const { fanOut, notify } = setup(row());
    await fanOut.handle(ev('job.started', '1'));
    await fanOut.handle(ev('job.started', '2'));
    expect(
      notify.mock.calls.map(
        (c) => (c as unknown as [{ eventId: string }])[0].eventId,
      ),
    ).toEqual(['1', '2']);
  });

  it('passes the same event id on a redelivery so notify can dedupe', async () => {
    const { fanOut, notify } = setup(row({ status: 'done' }));
    await fanOut.handle(ev('job.done', '9'));
    await fanOut.handle(ev('job.done', '9'));
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0]).toEqual(notify.mock.calls[1]);
  });
});

// @traces 277-FR-001
describe('job stage fan-out: actor and car under hostile data', () => {
  const started = async (over: Partial<Row>, opts: Opts = {}) => {
    const { fanOut, notify } = setup(row(over), opts);
    await fanOut.handle(ev('job.started'));
    return firstCall(notify)['params'] as Record<string, string>;
  };

  // featureOn: a garage with no row for a feature has it on.
  it('names the mechanic when the garage has no feature row', async () => {
    expect((await started({}, { feature: null }))['actor']).toBe('Mihai');
  });

  it('uses the garage when the mechanic name is only non-breaking spaces', async () => {
    expect((await started({ mechanic: { name: '  ' } }))['actor']).toBe(
      'Garaj Nordic',
    );
  });

  it('takes the first word of a name split by a tab or a newline', async () => {
    expect(
      (await started({ mechanic: { name: '\tIon\nPopescu' } }))['actor'],
    ).toBe('Ion');
  });

  it('keeps a hyphenated unicode first name whole', async () => {
    expect(
      (await started({ mechanic: { name: 'Ionuț-Șerban Țurcanu' } }))['actor'],
    ).toBe('Ionuț-Șerban');
  });

  it('never puts the mechanic surname in the actor', async () => {
    expect(
      (await started({ mechanic: { name: 'Mihai Popescu' } }))['actor'],
    ).not.toContain('Popescu');
  });

  it.each(['fr', '', 'EN', 'en-US'])(
    'renders the car in Romanian for the language %p',
    async (language) => {
      expect((await started({ driver: { language } }))['car']).toBe(
        'Dacia Logan',
      );
    },
  );

  it('trims padded brand and model and collapses to the bare brand', async () => {
    expect(
      (await started({ car: { brand: { name: '  Dacia ' }, model: '\t' } }))[
        'car'
      ],
    ).toBe('Dacia');
  });

  it('uses the model alone when the brand is blank', async () => {
    expect(
      (await started({ car: { brand: { name: ' ' }, model: 'Logan' } }))['car'],
    ).toBe('Logan');
  });

  it('passes a very long garage name through untruncated', async () => {
    const name = 'G'.repeat(10_000);
    expect(
      (await started({ garage: { name }, mechanic: null, mechanicId: null }))[
        'actor'
      ],
    ).toHaveLength(10_000);
  });
});

// @traces 277-FR-003
describe('job stage fan-out: link and recipient', () => {
  it('url-encodes a request id carrying a slash or a query', async () => {
    const { fanOut, notify } = setup(
      row({ booking: { requestId: 'a/b?x=1#y' }, status: 'done' }),
    );
    await fanOut.handle(ev('job.done'));
    expect((firstCall(notify)['params'] as { link: string }).link).toBe(
      'https://motorfix.test/app/driver/requests/a%2Fb%3Fx%3D1%23y',
    );
  });

  it('tells only the driver, once, with the job as subject', async () => {
    const { fanOut, notify } = setup(row({ status: 'done' }));
    await fanOut.handle(ev('job.done', '5', 'job-5'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(firstCall(notify)).toMatchObject({
      eventId: '5',
      recipients: ['d-1'],
      subjectId: 'job-5',
    });
  });

  it('reads the job by the event subject id', async () => {
    const { fanOut, prisma } = setup(row({ status: 'done' }));
    await fanOut.handle(ev('job.done', '5', 'job-5'));
    expect(
      JSON.stringify((prisma.job.findUnique as unknown as Mock).mock.calls),
    ).toContain('job-5');
  });

  it('only reads and never writes the workshop job', async () => {
    const { fanOut, prisma } = setup(row({ status: 'done' }));
    await fanOut.handle(ev('job.done'));
    expect(Object.keys(prisma.job)).toEqual(['findUnique']);
  });
});
