import { timersArmedBy, until } from './waits.testing';

// @traces 976-FR-007
describe('until', () => {
  it('resolves with the first value that is there', async () => {
    let reads = 0;

    const value = await until('the third read', () => ++reads >= 3 && reads);

    expect(value).toBe(3);
  });

  it('fails naming the condition and the deadline', async () => {
    await expect(until('the bell to ring', () => false, 60)).rejects.toThrow(
      'waited 60 ms for the bell to ring, and it never happened',
    );
  });
});

describe('timersArmedBy', () => {
  it('records the timers code in the named file arms, and when they fire', async () => {
    const { log } = await timersArmedBy('waits.testing.spec', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(log).toEqual(['armed 5', 'fired 5']);
  });

  it('leaves out the timers armed from other files', async () => {
    const { log } = await timersArmedBy('no-such-file', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(log).toEqual([]);
  });
});
