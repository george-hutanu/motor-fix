import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PickType,
} from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

import { FUELS } from './plate';
import {
  BOOKING_CANCEL_REASONS,
  BOOKING_STATUSES,
  type BookingCancelReasonCode,
  type BookingStatus,
  CANCELLED_BY_SIDES,
  type CancelledBySide,
  DECLINE_REASON_CODES,
  type DeclineReasonCode,
  GARAGE_CLOSE_REASONS,
  GARAGE_REQUEST_FILTERS,
  type GarageCloseReason,
  type GarageRequestFilter,
  QUOTE_STATUSES,
  type QuoteStatus,
  RECIPIENT_STATUSES,
  REQUEST_CLOSED_REASONS,
  REQUEST_SOURCES,
  REQUEST_STATUSES,
  type RecipientStatus,
  type RequestClosedReason,
  type RequestSource,
  type RequestStatus,
} from './request-status';

const NULLABLE_TIME = { format: 'date-time', nullable: true, type: String };

export class ListQueryDto {
  @ApiPropertyOptional({
    description: 'The nextCursor of the previous page',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class GarageRequestsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    description:
      'waiting: the rows the garage can still answer; closed: the rows closed for it in the last 24 hours, one page',
    enum: GARAGE_REQUEST_FILTERS,
  })
  @IsOptional()
  @IsIn(GARAGE_REQUEST_FILTERS)
  status?: GarageRequestFilter;
}

// The car as it was when the request was sent; never the plate.
export class CarSnapshotDto {
  @ApiProperty()
  brand!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ enum: FUELS })
  fuel!: (typeof FUELS)[number];

  @ApiProperty({ nullable: true, type: String })
  engine!: string | null;
}

// The plate shows once the booking is confirmed.
export class GarageCarDto extends CarSnapshotDto {
  @ApiPropertyOptional()
  plate?: string;
}

export class RequestJobDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  jobTypeId!: string;

  @ApiProperty()
  nameRo!: string;

  @ApiProperty()
  nameEn!: string;

  @ApiProperty()
  position!: number;
}

export class GarageRequestJobDto extends RequestJobDto {
  @ApiProperty({
    description: "The garage ticked this job for the request's car brand",
  })
  offered!: boolean;
}

export class GarageRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;
}

export class RecipientDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: GarageRefDto })
  garage!: GarageRefDto;

  @ApiProperty({ enum: RECIPIENT_STATUSES })
  status!: RecipientStatus;

  @ApiProperty(NULLABLE_TIME)
  answeredAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class QuoteJobDto {
  @ApiProperty({ format: 'uuid' })
  requestJobId!: string;

  @ApiProperty()
  included!: boolean;
}

export class QuoteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: GarageRefDto })
  garage!: GarageRefDto;

  @ApiProperty({ description: 'Lower end of the price, in bani' })
  fromBani!: number;

  @ApiProperty({ description: 'Upper end of the price, in bani' })
  toBani!: number;

  @ApiProperty()
  durationMinutes!: number;

  @ApiProperty({ description: 'The proposed start', format: 'date-time' })
  slot!: string;

  @ApiProperty({ nullable: true, type: String })
  note!: string | null;

  @ApiProperty({ enum: QUOTE_STATUSES })
  status!: QuoteStatus;

  @ApiProperty({ format: 'date-time' })
  sentAt!: string;

  @ApiProperty(NULLABLE_TIME)
  changedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty(NULLABLE_TIME)
  acceptedAt!: string | null;

  @ApiProperty(NULLABLE_TIME)
  withdrawnAt!: string | null;

  @ApiProperty({ type: [QuoteJobDto] })
  jobs!: QuoteJobDto[];
}

export class BookingDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  quoteId!: string;

  @ApiProperty({ type: GarageRefDto })
  garage!: GarageRefDto;

  @ApiProperty({ format: 'date-time' })
  startsAt!: string;

  @ApiProperty()
  durationMinutes!: number;

  @ApiProperty({ enum: BOOKING_STATUSES })
  status!: BookingStatus;

  @ApiProperty({ format: 'date-time' })
  confirmBy!: string;

  @ApiProperty(NULLABLE_TIME)
  confirmedAt!: string | null;

  @ApiProperty(NULLABLE_TIME)
  cancelledAt!: string | null;

  @ApiProperty({ enum: CANCELLED_BY_SIDES, nullable: true })
  cancelledBySide!: CancelledBySide | null;

  @ApiProperty({ enum: BOOKING_CANCEL_REASONS, nullable: true })
  cancelReason!: BookingCancelReasonCode | null;

  @ApiProperty(NULLABLE_TIME)
  noShowAt!: string | null;

  @ApiProperty(NULLABLE_TIME)
  completedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class RequestSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: REQUEST_STATUSES })
  status!: RequestStatus;

  @ApiProperty({ type: CarSnapshotDto })
  car!: CarSnapshotDto;

  @ApiProperty({ type: [RequestJobDto] })
  jobs!: RequestJobDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ enum: REQUEST_CLOSED_REASONS, nullable: true })
  closedReason!: RequestClosedReason | null;

  @ApiProperty(NULLABLE_TIME)
  closedAt!: string | null;

  @ApiProperty()
  quotesCount!: number;

  @ApiProperty({
    description:
      'As the driver wrote it; the list shows its first line when there is no job',
    nullable: true,
    type: String,
  })
  description!: string | null;
}

export class RequestDto extends RequestSummaryDto {
  @ApiProperty({ type: [RecipientDto] })
  recipients!: RecipientDto[];

  @ApiProperty({ type: [QuoteDto] })
  quotes!: QuoteDto[];

  @ApiProperty({ nullable: true, type: BookingDto })
  booking!: BookingDto | null;
}

export class RequestListDto {
  @ApiProperty({ type: [RequestSummaryDto] })
  items!: RequestSummaryDto[];

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  total!: number;
}

export class DriverNameDto {
  @ApiProperty({ description: 'First name and the last name’s initial' })
  shortName!: string;
}

// The phone shows once the garage's quote is accepted, never to a mechanic.
export class GarageDriverDto extends DriverNameDto {
  @ApiPropertyOptional()
  phone?: string;
}

export class GarageRecipientDto {
  @ApiProperty({ enum: RECIPIENT_STATUSES })
  status!: RecipientStatus;

  @ApiProperty({ enum: REQUEST_SOURCES })
  source!: RequestSource;

  @ApiProperty(NULLABLE_TIME)
  answeredAt!: string | null;

  @ApiProperty(NULLABLE_TIME)
  declinedAt!: string | null;

  @ApiProperty({ enum: DECLINE_REASON_CODES, nullable: true })
  declineReason!: DeclineReasonCode | null;
}

export class GarageQuoteDto extends OmitType(QuoteDto, ['garage'] as const) {}

export class GarageBookingDto extends OmitType(BookingDto, [
  'garage',
] as const) {
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  confirmedBy!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  mechanicId!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  lift!: number | null;

  @ApiProperty()
  moveCount!: number;

  @ApiProperty()
  historyShared!: boolean;

  @ApiProperty({ nullable: true, type: String })
  cancelNote!: string | null;

  @ApiProperty()
  lateCancellation!: boolean;
}

export class GarageRequestSummaryDto extends PickType(RequestSummaryDto, [
  'id',
  'status',
  'car',
  'createdAt',
  'expiresAt',
] as const) {
  @ApiProperty({ type: [GarageRequestJobDto] })
  jobs!: GarageRequestJobDto[];

  @ApiProperty({
    description: "The description's first line",
    nullable: true,
    type: String,
  })
  descriptionLine!: string | null;

  @ApiProperty({
    description: 'Set on the rows of a closed read',
    enum: GARAGE_CLOSE_REASONS,
    nullable: true,
  })
  closedReason!: GarageCloseReason | null;

  @ApiProperty({ ...NULLABLE_TIME, description: 'Set with closedReason' })
  closedAt!: string | null;

  @ApiProperty({ type: DriverNameDto })
  driver!: DriverNameDto;

  @ApiProperty({ type: GarageRecipientDto })
  recipient!: GarageRecipientDto;

  @ApiProperty({ nullable: true, type: GarageQuoteDto })
  quote!: GarageQuoteDto | null;
}

export class GarageRequestDto extends OmitType(GarageRequestSummaryDto, [
  'driver',
  'car',
] as const) {
  @ApiProperty({ type: GarageDriverDto })
  driver!: GarageDriverDto;

  @ApiProperty({ type: GarageCarDto })
  car!: GarageCarDto;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ nullable: true, type: GarageBookingDto })
  booking!: GarageBookingDto | null;
}

export class GarageRequestListDto {
  @ApiProperty({ type: [GarageRequestSummaryDto] })
  items!: GarageRequestSummaryDto[];

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  total!: number;
}
