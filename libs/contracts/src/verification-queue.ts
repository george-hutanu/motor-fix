import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { CheckSummaryDto, type Lamp } from './verification-checks';
import {
  VERIFICATION_QUEUE_MAX,
  VERIFICATION_QUEUE_PAGE,
} from './verification-target';

// A query number is digits only: an empty, blank or hex `?offset=` is
// malformed, never read as 0 or 16.
export const toQueryNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN
    : value;

export class VerificationQueueQueryDto {
  @ApiPropertyOptional({
    default: 0,
    maximum: 10_000,
    minimum: 0,
    type: 'integer',
  })
  @IsOptional()
  @Transform(toQueryNumber)
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset?: number;

  @ApiPropertyOptional({
    default: VERIFICATION_QUEUE_PAGE,
    description: 'A live re-read asks for every row already shown',
    maximum: VERIFICATION_QUEUE_MAX,
    minimum: 1,
    type: 'integer',
  })
  @IsOptional()
  @Transform(toQueryNumber)
  @IsInt()
  @Min(1)
  @Max(VERIFICATION_QUEUE_MAX)
  limit?: number;
}

export class VerificationQueueAreaDto {
  @ApiProperty({ enum: ['town', 'mobile'] })
  kind!: 'town' | 'mobile';

  @ApiPropertyOptional({ description: 'The town; only for a town' })
  name?: string;

  @ApiPropertyOptional({
    description: 'The service radius; only for a mobile mechanic',
    type: 'integer',
  })
  radiusKm?: number;
}

export const VERIFICATION_QUEUE_ITEMS = ['verification', 'documents'] as const;
export type VerificationQueueItem = (typeof VERIFICATION_QUEUE_ITEMS)[number];

export class VerificationQueueRowDto {
  @ApiProperty({
    description:
      "A file sent for verification, or an approved garage's yearly documents waiting for an admin",
    enum: VERIFICATION_QUEUE_ITEMS,
  })
  item!: VerificationQueueItem;

  @ApiProperty({ description: 'The verification file', format: 'uuid' })
  id!: string;

  @ApiProperty({
    description:
      'The yearly document uploaded first among those in review; null for a verification row',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  documentId!: string | null;

  @ApiProperty({ enum: ['submitted', 'in_review'] })
  status!: 'submitted' | 'in_review';

  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty()
  garageName!: string;

  @ApiPropertyOptional({
    description: 'Absent when the garage has no town recorded',
    type: VerificationQueueAreaDto,
  })
  area?: VerificationQueueAreaDto;

  @ApiProperty({
    description: 'Brands the garage works on',
    minimum: 0,
    type: 'integer',
  })
  brands!: number;

  @ApiPropertyOptional({
    description: "The garage's mechanics; absent when it keeps no team",
    minimum: 0,
    type: 'integer',
  })
  mechanics?: number;

  @ApiProperty({ type: CheckSummaryDto })
  summary!: CheckSummaryDto;

  @ApiPropertyOptional({
    description:
      'The names of the other listings that held the same CUI when it was sent, joined by ", "; a draft with no name yet is U+FFFC, which a client replaces with its own label; absent when none',
  })
  cuiWarning?: string;

  @ApiProperty({
    description:
      'Red on a failed check, amber when flagged or on a warning; a documents row is amber, red once its grace has ended or the garage is suspended',
    enum: ['green', 'amber', 'red', 'grey'],
  })
  lamp!: Lamp;

  @ApiProperty({
    description: 'The latest sending; for a documents row, its oldest upload',
    format: 'date-time',
  })
  submittedAt!: Date;

  @ApiProperty({
    description: 'Working days waited, in Europe/Bucharest',
    minimum: 0,
    type: 'integer',
  })
  workingDays!: number;

  @ApiProperty({ description: 'Waited more than the 2 working days' })
  flagged!: boolean;

  @ApiProperty({ description: 'Sent again after a request for more' })
  resubmitted!: boolean;

  @ApiPropertyOptional({
    description: 'When more was asked for; only when resubmitted',
    format: 'date-time',
  })
  requestedAt?: Date;
}

export class VerificationQueueDto {
  @ApiProperty({
    description: 'Oldest sending first',
    type: [VerificationQueueRowDto],
  })
  items!: VerificationQueueRowDto[];

  @ApiProperty({
    description:
      'Every file and yearly documents row waiting, as the overview counts them',
    minimum: 0,
    type: 'integer',
  })
  total!: number;
}
