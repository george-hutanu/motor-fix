import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { PAID_BANI_MAX, REVIEW_TEXT_MAX } from './lei-text';
import {
  CarSnapshotDto,
  DriverNameDto,
  GarageRefDto,
  RequestJobDto,
} from './quotes.dto';
import { JOB_STATUSES, type JobStatus } from './request-status';

export { REVIEW_TEXT_MAX };

const REVIEW_STATUSES = [
  'published',
  'reported',
  'removed',
  'deleted_by_author',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// Only the types are checked here: the ranges are the service's 422, so the
// driver reads which field is out of bounds.
export class PublishReviewDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  jobId!: string;

  @ApiProperty({ maximum: 5, minimum: 1 })
  @IsInt()
  rating!: number;

  @ApiPropertyOptional({ maxLength: REVIEW_TEXT_MAX })
  @IsOptional()
  // PostgreSQL cannot store a NUL character, so it goes before the trim.
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.replaceAll('\u0000', '').trim() || undefined
      : value,
  )
  @IsString()
  text?: string;

  @ApiPropertyOptional({ maximum: PAID_BANI_MAX, minimum: 1 })
  @IsOptional()
  @IsInt()
  paidBani?: number;
}

export class ReviewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty()
  rating!: number;

  @ApiProperty({ nullable: true, type: String })
  text!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  paidBani!: number | null;

  @ApiProperty({ enum: REVIEW_STATUSES })
  status!: ReviewStatus;

  @ApiProperty({ format: 'date-time' })
  postedAt!: string;
}

export class ReviewJobDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: JOB_STATUSES })
  status!: JobStatus;
}

// Why a driver may not review a job, in the order the publish checks them.
const REVIEW_REFUSALS = [
  'not_found',
  'job_not_done',
  'own_garage',
  'already_reviewed',
  'review_removed',
  'email_not_confirmed',
] as const;
export type ReviewRefusal = (typeof REVIEW_REFUSALS)[number];

const REVIEW_ELIGIBILITY_IDS_MAX = 50;

export class ReviewEligibilityQueryDto {
  @ApiProperty({
    description: `1 to ${REVIEW_ELIGIBILITY_IDS_MAX} job ids, comma-separated`,
    type: String,
  })
  // A repeated key arrives as a list and is refused with the rest.
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((id) => id.toLowerCase())
      : null,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(REVIEW_ELIGIBILITY_IDS_MAX)
  @IsUUID('all', { each: true })
  jobIds!: string[];
}

export class ReviewEligibilityDto {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  // Whether a screen shows "Scrie recenzia": an unconfirmed e-mail still
  // shows it, and the drawer asks for the confirmation.
  @ApiProperty()
  offer!: boolean;

  @ApiProperty({ enum: REVIEW_REFUSALS, nullable: true, type: String })
  reason!: ReviewRefusal | null;
}

export class JobReviewContextDto {
  // The name the published review will show, for the privacy line.
  @ApiProperty({ type: DriverNameDto })
  author!: DriverNameDto;

  @ApiProperty({ type: ReviewJobDto })
  job!: ReviewJobDto;

  @ApiProperty({ type: GarageRefDto })
  garage!: GarageRefDto;

  @ApiProperty({ type: CarSnapshotDto })
  car!: CarSnapshotDto;

  @ApiProperty({ type: [RequestJobDto] })
  jobs!: RequestJobDto[];

  @ApiProperty()
  emailConfirmed!: boolean;

  // An account signed up by phone has no address to send the link to.
  @ApiProperty()
  hasEmail!: boolean;

  @ApiProperty({ nullable: true, type: ReviewDto })
  existing!: ReviewDto | null;

  @ApiProperty({ type: ReviewEligibilityDto })
  eligibility!: ReviewEligibilityDto;
}
