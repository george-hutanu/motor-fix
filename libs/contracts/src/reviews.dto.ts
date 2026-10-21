import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

import { CarSnapshotDto, GarageRefDto, RequestJobDto } from './quotes.dto';
import { JOB_STATUSES, type JobStatus } from './request-status';

export const REVIEW_TEXT_MAX = 2000;
export const REVIEW_STATUSES = [
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
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  text?: string;

  @ApiPropertyOptional({ maximum: 100_000_000, minimum: 1 })
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

  @ApiProperty({ nullable: true, type: ReviewDto })
  existing!: ReviewDto | null;
}
