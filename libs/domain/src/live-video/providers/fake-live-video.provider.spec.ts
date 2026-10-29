import { FakeLiveVideo } from './fake-live-video.provider';
import { NONE } from './live-video.provider';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// @traces 1250-FR-001
describe('the stand-in live video provider', () => {
  it('opens a new input on the test host for every session', async () => {
    const fake = new FakeLiveVideo();

    const one = await fake.createInput({ id: 's1' });
    const two = await fake.createInput({ id: 's2' });

    if ('unavailable' in one || 'unavailable' in two) throw new Error('down');
    expect(one.inputId).toMatch(UUID);
    expect(two.inputId).not.toBe(one.inputId);
    expect(new URL(one.publishUrl).host).toBe('live.motorfix.test');
    expect(one.publishUrl).toContain(one.inputId);
  });

  it('names the low-latency manifest and when it expires', () => {
    const expiresAt = new Date('2026-10-26T10:05:00.000Z');

    expect(new FakeLiveVideo().viewUrl('input-1', expiresAt)).toBe(
      `https://live.motorfix.test/input-1/manifest/video.m3u8?protocol=llhls&exp=${expiresAt.getTime() / 1000}`,
    );
  });

  it('closes an input without a word', async () => {
    await expect(new FakeLiveVideo().closeInput('input-1')).resolves.toBe(
      undefined,
    );
  });
});

// @traces 333-FR-018
describe('deleting a kept recording', () => {
  it('records each recording the stand-in deleted', async () => {
    const fake = new FakeLiveVideo();

    await fake.deleteRecording('video-1');
    await fake.deleteRecording('video-2');

    expect(fake.deleted).toEqual(['video-1', 'video-2']);
  });

  it('does nothing when no provider is configured', async () => {
    await expect(NONE.deleteRecording('video-1')).resolves.toBe(undefined);
  });
});

// @traces 1251-FR-011
describe('the stand-in publisher state', () => {
  it('takes an input nobody set as never connected', async () => {
    await expect(new FakeLiveVideo().inputStatus('input-1')).resolves.toEqual({
      connected: false,
      since: null,
    });
  });

  it('answers from the table a test sets', async () => {
    const fake = new FakeLiveVideo();
    const since = new Date('2026-10-29T10:00:00.000Z');
    fake.statuses.set('input-1', { connected: true, since });

    await expect(fake.inputStatus('input-1')).resolves.toEqual({
      connected: true,
      since,
    });
  });

  it('says connected when no provider is configured, so nothing is stopped idle', async () => {
    await expect(NONE.inputStatus('input-1')).resolves.toEqual({
      connected: true,
      since: null,
    });
  });
});
