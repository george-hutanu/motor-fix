import { ApiProperty } from '@nestjs/swagger';

import { DriverNameDto, GarageCarDto } from './quotes.dto';
import { JOB_STATUSES, type JobStatus } from './request-status';

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
