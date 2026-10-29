import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

import type { MediaKind } from './media.dto';

// The window the sender has to begin publishing after a start.
export const LIVE_PUBLISH_WINDOW_MS = 2 * 60_000;
export const LIVE_VIEW_TOKEN_TTL_MS = 5 * 60_000;
export const LIVE_PROVIDER_TIMEOUT_MS = 5000;

// The provider cannot refuse sound at ingest, so the sender's app honours
// these.
export const LIVE_PUBLISH_CONSTRAINTS = {
  audio: false,
  video: { maxBitrateKbps: 1500, maxHeight: 720 },
} as const;

export const LIVE_REFUSALS = [
  'live_already_on',
  'job_closed',
  'live_unavailable',
  'live_ended',
] as const;
export type LiveRefusal = (typeof LIVE_REFUSALS)[number];

export class LiveVideoConstraintsDto {
  @ApiProperty({ example: 720 })
  maxHeight!: number;

  @ApiProperty({ example: 1500 })
  maxBitrateKbps!: number;
}

export class LivePublishConstraintsDto {
  @ApiProperty({ enum: [false], type: Boolean })
  audio!: false;

  @ApiProperty({ type: LiveVideoConstraintsDto })
  video!: LiveVideoConstraintsDto;
}

export class LivePublishCredentialDto {
  @ApiProperty({ description: 'The WHIP URL the sender publishes to' })
  url!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ type: LivePublishConstraintsDto })
  constraints!: LivePublishConstraintsDto;
}

export class LiveSessionStartedDto {
  @ApiProperty({ format: 'uuid' })
  liveSessionId!: string;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: LivePublishCredentialDto })
  publish!: LivePublishCredentialDto;
}

export class LiveViewCredentialDto {
  @ApiProperty({ description: 'The signed low-latency HLS manifest URL' })
  url!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class LiveRecordingKeepDto {
  @ApiProperty({ description: 'Keep the recording once the stream stops' })
  @IsBoolean()
  keep!: boolean;
}

export class LiveStopRequestDto {
  @ApiPropertyOptional({
    description: 'Keep the recording; absent keeps the session’s choice',
  })
  @IsOptional()
  @IsBoolean()
  keep?: boolean;
}

export class LiveSessionStoppedDto {
  @ApiProperty({ format: 'uuid' })
  liveSessionId!: string;

  @ApiProperty({ format: 'date-time' })
  stoppedAt!: string;

  @ApiProperty()
  keep!: boolean;

  @ApiProperty({ description: 'Whole seconds streamed, rounded down' })
  seconds!: number;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  recordingMediaId!: string | null;
}

export interface LiveStoppedPayload {
  liveSessionId: string;
  jobId: string;
  reason: 'job_closed' | 'feature_off' | 'sender' | 'idle';
  keep: boolean;
}

export interface MediaAddedPayload {
  mediaId: string;
  jobId: string;
  kind: MediaKind;
}
