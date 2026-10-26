import { EventEmitter } from 'node:events';

import type { Role } from '@motor-fix/contracts/capabilities';

import { LiveHub } from './live.hub';
import type { GarageAccess } from '../garage-access';

class Sink extends EventEmitter {
  chunks: string[] = [];
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {}
  kinds() {
    return this.chunks
      .filter((c) => c.startsWith('event:'))
      .map((c) => (c.split('\n')[0] ?? '').replace(/^event: /, ''))
      .filter((k) => k !== 'hello');
  }
}

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const access = (over: Partial<GarageAccess> = {}): GarageAccess => ({
  mechanics: new Map([['elena', { ...NONE }]]),
  off: new Set(),
  owners: new Set(['ion']),
  receptionists: new Set(['maria']),
  ...over,
});

let load: jest.Mock<Promise<GarageAccess>, [string]>;
let hub: LiveHub;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  load = jest.fn(async (_garageId: string) => access());
  hub = new LiveHub(load);
});

afterEach(() => {
  hub.shutdown();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const open = (
  accountId: string,
  role: Role,
  channels: string[],
  garageId = 'g1',
) => {
  const sink = new Sink();
  hub.open(sink, {
    accountId,
    channels: [`account:${accountId}`, 'system', ...channels],
    expiresAt: NOW + 15 * 60_000,
    garageId,
    role,
  });
  return sink;
};

const fanOut = (audience: string[], kind: string, id = 'e1') =>
  hub.deliver(
    JSON.stringify({
      audience,
      event: { at: new Date(NOW).toISOString(), id, kind },
    }),
  );

// @traces 398-FR-008
// @traces 1250-FR-004 1250-FR-013
describe('the feature switch event', () => {
  it('reaches a mechanic holding no permission at all', async () => {
    const mechanic = open('elena', 'mechanic', ['garage:g1', 'mechanic:m1']);

    await fanOut(['garage:g1'], 'garage.features_changed');

    expect(mechanic.kinds()).toEqual(['garage.features_changed']);
  });

  it('does not reach an account that is no longer a member of the garage', async () => {
    const removed = open('gone', 'receptionist', ['garage:g1']);

    await fanOut(['garage:g1'], 'garage.features_changed');

    expect(removed.kinds()).toEqual([]);
  });

  it('does not reach a driver whose stream names the garage channel', async () => {
    const driver = open('dan', 'driver', ['garage:g1']);

    await fanOut(['garage:g1'], 'garage.features_changed');

    expect(driver.kinds()).toEqual([]);
  });

  it("does not reach another garage's owner when only this garage is the audience", async () => {
    const elsewhere = open('zoe', 'garage', ['garage:g2'], 'g2');

    await fanOut(['garage:g1'], 'garage.features_changed');

    expect(elsewhere.kinds()).toEqual([]);
  });

  it('reaches the owner once when the audience names the garage twice', async () => {
    const owner = open('ion', 'garage', ['garage:g1']);

    await fanOut(['garage:g1', 'garage:g1'], 'garage.features_changed');

    expect(owner.kinds()).toEqual(['garage.features_changed']);
  });

  it('keeps reaching every staff stream on a second change', async () => {
    const owner = open('ion', 'garage', ['garage:g1']);
    const mechanic = open('elena', 'mechanic', ['garage:g1', 'mechanic:m1']);

    await fanOut(['garage:g1'], 'garage.features_changed', 'e1');
    await fanOut(['garage:g1'], 'garage.features_changed', 'e2');

    expect(owner.kinds()).toEqual([
      'garage.features_changed',
      'garage.features_changed',
    ]);
    expect(mechanic.kinds()).toEqual([
      'garage.features_changed',
      'garage.features_changed',
    ]);
  });

  it('stops live media for the garage right after the change that switched it off', async () => {
    const mechanic = open('elena', 'mechanic', ['garage:g1', 'mechanic:m1']);
    const owner = open('ion', 'garage', ['garage:g1']);
    await fanOut(['garage:g1'], 'media.added', 'a');
    load.mockResolvedValue(access({ off: new Set(['live_media']) }));

    await fanOut(['garage:g1'], 'garage.features_changed', 'b');
    await fanOut(['garage:g1'], 'media.added', 'c');

    expect(owner.kinds()).toEqual(['media.added', 'garage.features_changed']);
    expect(mechanic.kinds()).toContain('garage.features_changed');
  });

  it('drops live stream events for the staff while live media is off', async () => {
    const mechanic = open('elena', 'mechanic', ['garage:g1', 'mechanic:m1']);
    const owner = open('ion', 'garage', ['garage:g1']);
    load.mockResolvedValue(access({ off: new Set(['live_media']) }));

    await fanOut(['garage:g1', 'mechanic:m1'], 'live.started', 'a');
    await fanOut(['garage:g1', 'mechanic:m1'], 'live.stopped', 'b');

    expect(owner.kinds()).toEqual([]);
    expect(mechanic.kinds()).toEqual([]);
  });
});
