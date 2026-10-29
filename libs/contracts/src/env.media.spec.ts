// @traces 333-media-storage-FR-013
import { mediaConfig } from './env';

describe('mediaConfig', () => {
  it('keeps media 90 days and converts one item at a time by default', () => {
    expect(mediaConfig({})).toEqual({
      retentionDays: 90,
      workerConcurrency: 1,
    });
  });

  it('honours the retention days and the concurrency the environment sets', () => {
    expect(
      mediaConfig({
        MEDIA_RETENTION_DAYS: '30',
        MEDIA_WORKER_CONCURRENCY: '3',
      }),
    ).toEqual({ retentionDays: 30, workerConcurrency: 3 });
  });

  it.each(['0', '-5', '1.5', 'ninety', '1e3', ' 30'])(
    'refuses %p as the retention days, naming the variable',
    (value) => {
      expect(() => mediaConfig({ MEDIA_RETENTION_DAYS: value })).toThrow(
        /MEDIA_RETENTION_DAYS/,
      );
    },
  );

  it('treats an empty retention value as unset', () => {
    expect(mediaConfig({ MEDIA_RETENTION_DAYS: '' }).retentionDays).toBe(90);
  });

  it('falls back to one conversion at a time for a value that is not a whole number', () => {
    expect(
      mediaConfig({ MEDIA_WORKER_CONCURRENCY: 'many' }).workerConcurrency,
    ).toBe(1);
  });
});
