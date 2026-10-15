import { measure, sendMeasurementsTo } from './measure';

describe('measure', () => {
  afterEach(() => sendMeasurementsTo(undefined));

  it('goes nowhere before telemetry starts', () => {
    expect(() =>
      measure('prefetch', { duration: 1 }, { outcome: 'hit', path: 'profile' }),
    ).not.toThrow();
  });

  it('hands each measurement to the sink set last', () => {
    const first = jest.fn();
    const second = jest.fn();
    sendMeasurementsTo(first);
    sendMeasurementsTo(second);

    measure(
      'prefetch',
      { duration: 7 },
      { outcome: 'fetched', path: 'profile' },
    );

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(
      'prefetch',
      { duration: 7 },
      { outcome: 'fetched', path: 'profile' },
    );
  });

  it('never lets a failing sink break the page', () => {
    sendMeasurementsTo(() => {
      throw new Error('collector gone');
    });

    expect(() =>
      measure(
        'prefetch',
        { duration: 0 },
        { outcome: 'skipped', path: 'profile' },
      ),
    ).not.toThrow();
  });

  it('stops sending once the sink is removed', () => {
    const sink = jest.fn();
    sendMeasurementsTo(sink);
    sendMeasurementsTo(undefined);

    measure('prefetch', { duration: 0 }, { outcome: 'hit', path: 'profile' });

    expect(sink).not.toHaveBeenCalled();
  });
});
