import { metrics } from '@opentelemetry/api';

import {
  MEDIA_RETENTION_STEPS,
  type MediaRetentionDeps,
  runMediaRetention,
} from './retention';

const deps = () => {
  const logger = { error: jest.fn(), log: jest.fn() };
  return { deps: { logger } as unknown as MediaRetentionDeps, logger };
};

afterEach(() => jest.restoreAllMocks());

// @traces 333-FR-013
describe('the nightly media run', () => {
  it('holds the purge alone', () => {
    expect(MEDIA_RETENTION_STEPS.map((step) => step.name)).toEqual(['purge']);
  });

  it('runs its steps in order, and a step that throws stops none after it', async () => {
    const add = jest.fn();
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: () => ({ add }),
    } as never);
    const { deps: d, logger } = deps();
    const ran: string[] = [];
    const now = new Date('2026-10-29T01:00:00Z');

    const failed = await runMediaRetention(d, now, [
      { name: 'one', run: async () => void ran.push('one') },
      {
        name: 'two',
        run: async () => {
          ran.push('two');
          throw new TypeError('media_photo/job/secret-key');
        },
      },
      {
        name: 'three',
        run: async (_, at) => void ran.push(`three ${at.toISOString()}`),
      },
    ]);

    expect(ran).toEqual(['one', 'two', `three ${now.toISOString()}`]);
    expect(failed).toEqual(['two']);
    expect(add).toHaveBeenCalledWith(1, { step: 'two' });
    expect(logger.error).toHaveBeenCalledWith(
      'media retention two failed: TypeError',
    );
  });
});
