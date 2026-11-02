import { ApiProperty } from '@nestjs/swagger';

import { GarageRefDto, RequestJobDto } from './quotes.dto';

const ACTIVE_REQUEST_STAGES = [
  'sent',
  'quoted',
  'booked',
  'in_work',
  'done',
] as const;
export type ActiveRequestStage = (typeof ACTIVE_REQUEST_STAGES)[number];

const ACTIVE_BOOKING_STATUSES = [
  'awaiting_confirmation',
  'confirmed',
  'completed',
] as const;

const ACTIVE_JOB_STATUSES = ['to_do', 'in_work', 'paused', 'done'] as const;

const ACTIVE_STEP_STATES = ['done', 'now', 'todo'] as const;

const TIME = { format: 'date-time', type: String };
const NULLABLE_TIME = { ...TIME, nullable: true };

export class ActiveRequestCarDto {
  @ApiProperty()
  brand!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;
}

export class ActiveRequestRangeDto {
  @ApiProperty({ description: 'Lower end, in bani' })
  fromBani!: number;

  @ApiProperty({ description: 'Upper end, in bani' })
  toBani!: number;
}

// The garage to offer saving after a finished job there.
export class SaveSuggestionDto {
  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty()
  name!: string;
}

export class ActiveRequestBookingDto {
  @ApiProperty({ type: GarageRefDto })
  garage!: GarageRefDto;

  @ApiProperty({ enum: ACTIVE_BOOKING_STATUSES })
  status!: (typeof ACTIVE_BOOKING_STATUSES)[number];

  @ApiProperty(TIME)
  startsAt!: string;

  @ApiProperty(TIME)
  confirmBy!: string;
}

export class ActiveRequestStepDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  text!: string;

  @ApiProperty({ enum: ACTIVE_STEP_STATES })
  state!: (typeof ACTIVE_STEP_STATES)[number];
}

export class ActiveRequestJobDto {
  @ApiProperty({ enum: ACTIVE_JOB_STATUSES })
  status!: (typeof ACTIVE_JOB_STATUSES)[number];

  @ApiProperty(NULLABLE_TIME)
  startedAt!: string | null;

  @ApiProperty({
    ...NULLABLE_TIME,
    description:
      'The estimate the garage set, else the start plus the booking’s duration, up to a 5-minute mark; null when done',
  })
  etaAt!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  finalPriceBani!: number | null;

  @ApiProperty({ type: [ActiveRequestStepDto] })
  steps!: ActiveRequestStepDto[];
}

// The driver's open request closest to the workshop, with what its stage
// shows.
export class ActiveRequestDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ACTIVE_REQUEST_STAGES })
  stage!: ActiveRequestStage;

  @ApiProperty({ type: ActiveRequestCarDto })
  car!: ActiveRequestCarDto;

  @ApiProperty({ type: [RequestJobDto] })
  jobs!: RequestJobDto[];

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ nullable: true, type: ActiveRequestRangeDto })
  range!: ActiveRequestRangeDto | null;

  @ApiProperty({ nullable: true, type: ActiveRequestBookingDto })
  booking!: ActiveRequestBookingDto | null;

  @ApiProperty({ nullable: true, type: String })
  mechanicName!: string | null;

  @ApiProperty({ nullable: true, type: ActiveRequestJobDto })
  job!: ActiveRequestJobDto | null;

  @ApiProperty({ nullable: true, type: SaveSuggestionDto })
  saveSuggestion!: SaveSuggestionDto | null;
}

export class ActiveRequestAnswerDto {
  @ApiProperty({ nullable: true, type: ActiveRequestDto })
  request!: ActiveRequestDto | null;

  @ApiProperty({ description: 'How many of the driver’s requests are open' })
  openCount!: number;
}
