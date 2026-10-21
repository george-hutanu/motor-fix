import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

import { PAID_BANI_MAX } from './lei-text';
import {
  CarSnapshotDto,
  DriverNameDto,
  GarageRefDto,
  RequestJobDto,
} from './quotes.dto';
import { JOB_STATUSES, type JobStatus } from './request-status';

export const REVIEW_TEXT_MAX = 2000;
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
}
