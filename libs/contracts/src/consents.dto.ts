import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsIn, IsISO8601, IsUUID, Matches } from 'class-validator';

import {
  ANALYTICS_CONSENT_VERSION,
  CONSENT_DECISIONS,
  type ConsentDecision,
} from './consent';

// A date and a time with its zone: a time without one would be read in the
// server's own zone and shift the clock check.
const DATE_TIME_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const LANGUAGES = ['ro', 'en'] as const;

// One choice made in the consent bar or "Setări cookie". The account is the
// session's, never the body's.
export class RecordConsentDto {
  @ApiProperty({ description: 'Made once by the browser', format: 'uuid' })
  @IsUUID()
  browserConsentId!: string;

  @ApiProperty({ enum: CONSENT_DECISIONS })
  @IsIn(CONSENT_DECISIONS)
  decision!: ConsentDecision;

  @ApiProperty({
    description: 'The text the choice was made under; only the current one',
    example: ANALYTICS_CONSENT_VERSION,
  })
  @Equals(ANALYTICS_CONSENT_VERSION)
  textVersion!: string;

  @ApiProperty({ enum: LANGUAGES })
  @IsIn(LANGUAGES)
  language!: 'ro' | 'en';

  @ApiProperty({
    description:
      'When the choice was made, by the browser; at most 5 minutes ahead of the server',
    format: 'date-time',
  })
  @IsISO8601({ strict: true })
  @Matches(DATE_TIME_WITH_ZONE)
  at!: string;
}

export class ConsentRecordedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
}

export class AnalyticsConsentDto {
  @ApiProperty({ enum: CONSENT_DECISIONS })
  decision!: ConsentDecision;

  @ApiProperty()
  textVersion!: string;

  @ApiProperty({ enum: LANGUAGES })
  language!: 'ro' | 'en';

  @ApiProperty({ format: 'date-time' })
  at!: string;
}

export class AcceptedTextDto {
  @ApiProperty({ enum: ['terms', 'privacy_notice'] })
  kind!: 'terms' | 'privacy_notice';

  @ApiProperty()
  textVersion!: string;

  @ApiProperty({ enum: LANGUAGES })
  language!: 'ro' | 'en';

  @ApiProperty({ format: 'date-time' })
  acceptedAt!: string;
}

export class MyConsentsDto {
  @ApiProperty({
    description: 'The analytics choice with the latest time; null when none',
    nullable: true,
    type: AnalyticsConsentDto,
  })
  analytics!: AnalyticsConsentDto | null;

  @ApiProperty({
    description: 'The latest accepted version of each text',
    type: [AcceptedTextDto],
  })
  accepted!: AcceptedTextDto[];
}
