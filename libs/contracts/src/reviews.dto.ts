import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import {
  DELETED_AUTHOR,
  PAID_BANI_MAX,
  REVIEW_REPORT_TEXT_MAX,
  REVIEW_TEXT_MAX,
} from './lei-text';
import {
  CarSnapshotDto,
  DriverNameDto,
  GarageRefDto,
  RequestJobDto,
} from './quotes.dto';
import { JOB_STATUSES, type JobStatus } from './request-status';
import { toQueryNumber } from './verification-queue';

export { DELETED_AUTHOR, REVIEW_TEXT_MAX };

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

export const MECHANIC_REVIEWS_PAGE = 20;

export class MechanicReviewsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, type: 'integer' })
  @IsOptional()
  @Transform(toQueryNumber)
  @IsInt()
  @Min(1)
  page?: number;
}

// A published review on a mechanic's page: the author by short name only.
export class MechanicReviewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maximum: 5, minimum: 1 })
  rating!: number;

  @ApiProperty({ nullable: true, type: String })
  text!: string | null;

  @ApiProperty({ format: 'date-time' })
  postedAt!: string;

  @ApiProperty({ type: DriverNameDto })
  author!: DriverNameDto;

  // The garage the job was done at, which may not be the mechanic's now.
  @ApiProperty({ type: GarageRefDto })
  garage!: GarageRefDto;
}

export class MechanicReviewsPageDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty({ type: [MechanicReviewDto] })
  items!: MechanicReviewDto[];
}

// How many published reviews gave each score, five stars first.
export class RatingBreakdownDto {
  @ApiProperty()
  five!: number;

  @ApiProperty()
  four!: number;

  @ApiProperty()
  three!: number;

  @ApiProperty()
  two!: number;

  @ApiProperty()
  one!: number;
}

// The range of the quote the driver booked, in bani; the ends may be equal.
export class GarageReviewQuoteDto {
  @ApiProperty()
  fromBani!: number;

  @ApiProperty()
  toBani!: number;
}

// A published review on a garage's profile: the author by short name only,
// and for a job review the car and the jobs the garage did.
export class GarageReviewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['job', 'profile'] })
  source!: 'job' | 'profile';

  @ApiProperty({ maximum: 5, minimum: 1 })
  rating!: number;

  @ApiProperty({ nullable: true, type: String })
  text!: string | null;

  @ApiProperty({ format: 'date-time' })
  postedAt!: string;

  @ApiProperty({ type: DriverNameDto })
  author!: DriverNameDto;

  @ApiProperty({ nullable: true, type: CarSnapshotDto })
  car!: CarSnapshotDto | null;

  @ApiProperty({ type: [RequestJobDto] })
  jobs!: RequestJobDto[];

  // The amounts are a job review's only: a profile review carries none.
  @ApiProperty({ nullable: true, type: GarageReviewQuoteDto })
  quote!: GarageReviewQuoteDto | null;

  @ApiProperty({ nullable: true, type: Number })
  finalPriceBani!: number | null;

  @ApiProperty({
    description: 'What the driver says they paid',
    nullable: true,
    type: Number,
  })
  paidBani!: number | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  editedAt!: string | null;
}

export class GarageReviewsPageDto {
  @ApiProperty({
    description: "The garage's stored rating",
    nullable: true,
    type: Number,
  })
  rating!: number | null;

  @ApiProperty({ description: "The garage's stored review count" })
  reviewCount!: number;

  @ApiProperty({ type: RatingBreakdownDto })
  breakdown!: RatingBreakdownDto;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty({ description: 'Published reviews; the breakdown sums to it' })
  total!: number;

  @ApiProperty({ type: [GarageReviewDto] })
  items!: GarageReviewDto[];
}

// The reasons a garage may report a review for, in the order the task lists
// them.
export const REVIEW_REPORT_REASONS = [
  'insults',
  'personal_data',
  'ads',
  'promotion',
  'off_topic',
  'hate',
  'fake_or_conflicted',
  'threats_or_legal_accusations',
  'other',
] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

// Why a review may not be reported again.
export const REPORT_REFUSALS = ['already_reported', 'already_kept'] as const;
export type ReportRefusal = (typeof REPORT_REFUSALS)[number];

// Only the types are checked here: whether the text fits the reason is the
// service's 422, after the 409s.
export class ReportReviewDto {
  @ApiProperty({ enum: REVIEW_REPORT_REASONS })
  @IsIn(REVIEW_REPORT_REASONS)
  reason!: ReviewReportReason;

  @ApiPropertyOptional({
    description: 'Only with the reason other',
    maxLength: REVIEW_REPORT_TEXT_MAX,
  })
  @IsOptional()
  // PostgreSQL cannot store a NUL character, so it goes before the trim.
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.replaceAll('\u0000', '').trim() || undefined
      : value,
  )
  @IsString()
  text?: string;
}

export class ReviewReportReviewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: REVIEW_STATUSES })
  status!: ReviewStatus;
}

export class ReviewReportDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: REVIEW_REPORT_REASONS })
  reason!: ReviewReportReason;

  @ApiProperty({ enum: ['pending'] })
  status!: 'pending';

  @ApiProperty({
    description: 'When an admin is due to decide',
    format: 'date-time',
  })
  dueAt!: string;

  @ApiProperty({ type: ReviewReportReviewDto })
  review!: ReviewReportReviewDto;
}
