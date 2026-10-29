import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  LIVE_PROVIDER_TIMEOUT_MS,
  LIVE_PUBLISH_CONSTRAINTS,
  LIVE_PUBLISH_WINDOW_MS,
  LIVE_REFUSALS,
  LIVE_VIEW_TOKEN_TTL_MS,
  LivePublishCredentialDto,
  LiveRecordingKeepDto,
  LiveSessionStartedDto,
  LiveSessionStoppedDto,
  LiveStopRequestDto,
  LiveViewCredentialDto,
} from './video-sessions.dto';

const listed = (dto: object) =>
  (
    (Reflect.getMetadata('swagger/apiModelPropertiesArray', dto) ??
      []) as string[]
  ).map((name) => name.replace(/^:/, ''));

const failed = <T extends object>(type: new () => T, body: unknown) =>
  validateSync(plainToInstance(type, body as object), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);

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

// @traces 1251-FR-008
describe('the stop and keep contract', () => {
  it('requires a boolean keep on the keep change', () => {
    expect(failed(LiveRecordingKeepDto, { keep: true })).toEqual([]);
    expect(failed(LiveRecordingKeepDto, { keep: false })).toEqual([]);
    expect(failed(LiveRecordingKeepDto, {})).toEqual(['keep']);
    expect(failed(LiveRecordingKeepDto, { keep: 'false' })).toEqual(['keep']);
    expect(failed(LiveRecordingKeepDto, { keep: 0 })).toEqual(['keep']);
  });

  it('takes an empty stop or a boolean keep on the stop', () => {
    expect(failed(LiveStopRequestDto, {})).toEqual([]);
    expect(failed(LiveStopRequestDto, { keep: false })).toEqual([]);
    expect(failed(LiveStopRequestDto, { keep: true })).toEqual([]);
    expect(failed(LiveStopRequestDto, { keep: 'yes' })).toEqual(['keep']);
  });

  it('refuses any other field on either body', () => {
    expect(failed(LiveRecordingKeepDto, { keep: true, reason: 'x' })).toEqual([
      'reason',
    ]);
    expect(failed(LiveStopRequestDto, { seconds: 3 })).toEqual(['seconds']);
  });

  it('documents every field of the stop answer', () => {
    expect(listed(LiveSessionStoppedDto.prototype).sort()).toEqual([
      'keep',
      'liveSessionId',
      'recordingMediaId',
      'seconds',
      'stoppedAt',
    ]);
    expect(listed(LiveRecordingKeepDto.prototype)).toEqual(['keep']);
  });
});
