import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import { observeUnsent } from './gauge';

// @traces 280-FR-021

const reader = countedMetrics();
const unsent = () => counterTotal(reader, 'motorfix_support_messages_unsent');

describe('the unsent support messages gauge', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reads again every minute and reports the latest count', async () => {
    const read = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(5);
    const stop = observeUnsent(read);

    await jest.advanceTimersByTimeAsync(0);
    expect(await unsent()).toBe(2);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(await unsent()).toBe(5);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });

  it('keeps the count before a reading that fails, and logs the failure', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const read = jest
      .fn()
      .mockResolvedValueOnce(3)
      .mockRejectedValueOnce(new Error('database away'));
    const stop = observeUnsent(read);

    await jest.advanceTimersByTimeAsync(60_000);

    expect(read).toHaveBeenCalledTimes(2);
    expect(await unsent()).toBe(3);
    expect(warn).toHaveBeenCalledWith(
      'unsent support messages not read: database away',
    );
    stop();
  });

  it('stops reading once stopped', async () => {
    const read = jest.fn().mockResolvedValue(1);
    const stop = observeUnsent(read);
    stop();

    await jest.advanceTimersByTimeAsync(180_000);

    expect(read).toHaveBeenCalledTimes(1);
  });
});
