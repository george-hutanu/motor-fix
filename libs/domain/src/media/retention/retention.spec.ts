import { metrics } from '@opentelemetry/api';

import { purgedText } from './purge';
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

// @traces 333-media-storage-FR-013
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

// @traces 333-media-storage-FR-014
describe('the purge’s audit text', () => {
  it.each([
    [1, 90, '1 fișier șters după 90 de zile'],
    [3, 90, '3 fișiere șterse după 90 de zile'],
    [20, 7, '20 de fișiere șterse după 7 zile'],
    [101, 1, '101 fișiere șterse după 1 zi'],
  ])('says %i files after %i days in Romanian', (count, days, text) => {
    expect(purgedText(count, days)).toBe(text);
  });
});
