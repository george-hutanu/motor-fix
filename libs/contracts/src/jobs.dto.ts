import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

import {
  DriverNameDto,
  GarageCarDto,
  ListQueryDto,
  RequestJobDto,
} from './quotes.dto';
import { JOB_STATUSES, JOB_STEPS_MAX, type JobStatus } from './request-status';

const NULLABLE_TIME = { format: 'date-time', nullable: true, type: String };

const ACTOR_ROLES = [
  'driver',
  'owner',
  'receptionist',
  'mechanic',
  'admin',
  'system',
] as const;

export class JobSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  bookingId!: string;

  @ApiProperty({ enum: JOB_STATUSES })
  status!: JobStatus;

  @ApiProperty({ type: DriverNameDto })
  driver!: DriverNameDto;

  @ApiProperty({ type: GarageCarDto })
  car!: GarageCarDto;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  mechanicId!: string | null;

  @ApiProperty(NULLABLE_TIME)
  startedAt!: string | null;

  @ApiProperty(NULLABLE_TIME)
  pausedAt!: string | null;

  @ApiProperty(NULLABLE_TIME)
  finishedAt!: string | null;

  @ApiProperty(NULLABLE_TIME)
  handedOverAt!: string | null;

  @ApiProperty(NULLABLE_TIME)
  etaAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ description: "The booking's start", format: 'date-time' })
  startsAt!: string;

  @ApiProperty({ type: [RequestJobDto] })
  jobs!: RequestJobDto[];

  @ApiProperty({ nullable: true, type: String })
  mechanicName!: string | null;

  @ApiProperty({ description: 'Steps ticked' })
  stepsDone!: number;

  @ApiProperty({ description: 'Steps written, 0 to 20' })
  stepsTotal!: number;
}

export class JobStepDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  position!: number;

  @ApiProperty()
  label!: string;

  @ApiProperty({ nullable: true, type: String })
  customerLabel!: string | null;

  @ApiProperty(NULLABLE_TIME)
  doneAt!: string | null;

  @ApiProperty({
    description: 'The account that ticked it',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  doneBy!: string | null;
}

export class JobStageEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: JOB_STATUSES, nullable: true })
  fromStatus!: JobStatus | null;

  @ApiProperty({ enum: JOB_STATUSES })
  toStatus!: JobStatus;

  @ApiProperty({ enum: ACTOR_ROLES })
  actorRole!: (typeof ACTOR_ROLES)[number];

  @ApiProperty({ nullable: true, type: String })
  text!: string | null;

  @ApiProperty({ format: 'date-time' })
  at!: string;
}

export class JobDto extends JobSummaryDto {
  @ApiProperty({ nullable: true, type: Number })
  finalPriceBani!: number | null;

  @ApiProperty({ type: [JobStepDto] })
  steps!: JobStepDto[];

  @ApiProperty({ type: [JobStageEntryDto] })
  stages!: JobStageEntryDto[];
}

export class JobListDto {
  @ApiProperty({ type: [JobSummaryDto] })
  items!: JobSummaryDto[];

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  total!: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class JobListQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    description: 'The first day listed, in Bucharest; today when absent',
    example: '2026-10-09',
    format: 'date',
  })
  @IsOptional()
  @Matches(DAY)
  @IsISO8601({ strict: true })
  from?: string;
}

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class JobStepTextDto {
  @ApiProperty({
    description: 'Trimmed, 2 to 80 characters',
    maxLength: 80,
    minLength: 2,
  })
  @Transform(trimmed)
  @IsString()
  @Length(2, 80)
  text!: string;
}

export class ReorderJobStepsDto {
  @ApiProperty({
    description: 'Every step of the job, once each, in the new order',
    format: 'uuid',
    maxItems: JOB_STEPS_MAX,
    minItems: 1,
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(JOB_STEPS_MAX)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  stepIds!: string[];
}

export class JobStepDoneDto {
  @ApiProperty({ description: 'true ticks the step, false unticks it' })
  @IsBoolean()
  done!: boolean;
}
