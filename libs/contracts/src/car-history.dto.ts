import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CarRepairCarDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  brandName!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty({ type: 'integer' })
  year!: number;
}

const REPAIR_REVIEW_STATES = [
  'can_write',
  'written',
  'removed',
  'expired',
  'none',
] as const;

export type RepairReviewState = (typeof REPAIR_REVIEW_STATES)[number];

export class RepairReviewDto {
  @ApiProperty({
    description:
      'can_write: the driver may review the job; written: his review stands; removed: MotorFix removed it; expired: the window closed; none: he may not review it',
    enum: REPAIR_REVIEW_STATES,
  })
  state!: RepairReviewState;

  @ApiProperty({ description: 'The job to review', format: 'uuid' })
  jobId!: string;

  @ApiProperty({
    description: 'Only with written',
    maximum: 5,
    minimum: 1,
    nullable: true,
    type: 'integer',
  })
  rating!: number | null;

  @ApiProperty({
    description: 'With written and removed',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  reviewId!: string | null;
}

export class CarRepairDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date' })
  doneOn!: string;

  @ApiProperty({ description: 'What was done' })
  what!: string;

  @ApiProperty()
  garageName!: string;

  @ApiProperty({
    description: 'The garage on MotorFix',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  garageId!: string | null;

  @ApiProperty({ type: CarRepairCarDto })
  car!: CarRepairCarDto;

  @ApiProperty({
    description: "A MotorFix repair's mechanic, as the job names them",
    nullable: true,
    type: String,
  })
  mechanicName!: string | null;

  @ApiProperty({
    description:
      'The review of a MotorFix repair; null for a repair the driver logged',
    nullable: true,
    type: RepairReviewDto,
  })
  review!: RepairReviewDto | null;

  @ApiProperty({ enum: ['motorfix', 'logged'] })
  source!: 'motorfix' | 'logged';

  @ApiProperty({
    description: 'Created before the reader held the car: it came with it',
  })
  fromPreviousOwner!: boolean;

  @ApiProperty({ nullable: true, type: 'integer' })
  odometerKm!: number | null;

  @ApiProperty({ description: 'In bani', nullable: true, type: 'integer' })
  costBani!: number | null;

  @ApiProperty({
    description:
      'Who last corrected it: the garage it names or an admin; none for the driver',
    enum: ['garage', 'admin'],
    nullable: true,
    type: String,
  })
  correctedBy!: 'garage' | 'admin' | null;
}

export class CarRepairListDto {
  @ApiProperty({ description: 'Newest first', type: [CarRepairDto] })
  items!: CarRepairDto[];
}

export class RepairsQueryDto {
  @ApiPropertyOptional({ description: 'The nextCursor of the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({
    default: 20,
    description: 'Repairs per page',
    maximum: 20,
    minimum: 1,
    type: 'integer',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @ApiPropertyOptional({
    description: 'One of the caller’s cars',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  carId?: string;
}

export class RepairListDto {
  @ApiProperty({
    description: 'Newest first, across the caller’s cars',
    type: [CarRepairDto],
  })
  items!: CarRepairDto[];

  @ApiProperty({
    description: 'Pass as cursor for the next page; null on the last',
    nullable: true,
    type: String,
  })
  nextCursor!: string | null;
}

export class SoldCarDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  brandName!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ format: 'date' })
  saleDate!: string;
}

export class SoldCarListDto {
  @ApiProperty({ description: 'Newest sale first', type: [SoldCarDto] })
  items!: SoldCarDto[];
}
