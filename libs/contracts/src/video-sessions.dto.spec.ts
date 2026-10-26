import 'reflect-metadata';

import {
  LIVE_PROVIDER_TIMEOUT_MS,
  LIVE_PUBLISH_CONSTRAINTS,
  LIVE_PUBLISH_WINDOW_MS,
  LIVE_REFUSALS,
  LIVE_VIEW_TOKEN_TTL_MS,
  LivePublishCredentialDto,
  LiveSessionStartedDto,
  LiveViewCredentialDto,
} from './video-sessions.dto';

const listed = (dto: object) =>
  (
    (Reflect.getMetadata('swagger/apiModelPropertiesArray', dto) ??
      []) as string[]
  ).map((name) => name.replace(/^:/, ''));

// @traces 1250-FR-008
describe('the live session contract', () => {
  it('opens a two-minute publish window and a five-minute view token', () => {
    expect(LIVE_PUBLISH_WINDOW_MS).toBe(120_000);
    expect(LIVE_VIEW_TOKEN_TTL_MS).toBe(300_000);
    expect(LIVE_PROVIDER_TIMEOUT_MS).toBe(5000);
  });

  it('publishes video only, at most 720p and 1500 kbps', () => {
    expect(LIVE_PUBLISH_CONSTRAINTS).toEqual({
      audio: false,
      video: { maxBitrateKbps: 1500, maxHeight: 720 },
    });
  });

  it('names the four refusals a client can meet', () => {
    expect([...LIVE_REFUSALS].sort()).toEqual([
      'job_closed',
      'live_already_on',
      'live_ended',
      'live_unavailable',
    ]);
  });

  it('documents every field of the start and view answers', () => {
    expect(listed(LiveSessionStartedDto.prototype).sort()).toEqual([
      'liveSessionId',
      'publish',
      'startedAt',
    ]);
    expect(listed(LivePublishCredentialDto.prototype).sort()).toEqual([
      'constraints',
      'expiresAt',
      'url',
    ]);
    expect(listed(LiveViewCredentialDto.prototype).sort()).toEqual([
      'expiresAt',
      'url',
    ]);
  });
});
