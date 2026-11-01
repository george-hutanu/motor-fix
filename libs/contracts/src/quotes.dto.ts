import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PickType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDivisibleBy,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import { FUELS } from './plate';
import {
  QUOTE_DURATION_MAX_MINUTES,
  QUOTE_DURATION_MIN_MINUTES,
  QUOTE_LEI_MAX,
  QUOTE_LEI_MIN,
  QUOTE_NOTE_MAX,
} from './quote-limits';
import {
  BOOKING_CANCEL_NOTE_MAX,
  BOOKING_CANCEL_REASONS,
  BOOKING_STATUSES,
  type BookingCancelReasonCode,
  type BookingStatus,
  CANCELLED_BY_SIDES,
  type CancelledBySide,
  DECLINE_REASON_CODES,
  type DeclineReasonCode,
  DRIVER_CANCEL_REASONS,
  type DriverCancelReasonCode,
  GARAGE_CLOSE_REASONS,
  GARAGE_REQUEST_FILTERS,
  type GarageCloseReason,
  type GarageRequestFilter,
  QUOTE_OUTCOMES,
  QUOTE_STATUSES,
  type QuoteOutcome,
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
import { TimeBlockDto } from './time-blocks.dto';

// Far above any garage's lifts; keeps the number inside the column's range.
const LIFT_MAX = 99;

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
      'waiting: the rows the garage can still answer; closed: the rows closed for it in the last 24 hours, one page; quoted: the rows the garage quoted whose quote still waits or was accepted and waits for the garage’s confirmation, newest quote first',
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

// The garage's price-list row for a job: the car's brand row, else its
// default row.
export class GarageRequestJobPriceDto {
  @ApiProperty({ description: 'Lower end of the price, in bani' })
  fromBani!: number;

  @ApiProperty({
    description: 'Upper end of the price, in bani; null when open-ended',
    nullable: true,
    type: Number,
  })
  toBani!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  durationMinutes!: number | null;
}

export class GarageRequestDetailJobDto extends GarageRequestJobDto {
  @ApiProperty({ nullable: true, type: GarageRequestJobPriceDto })
  price!: GarageRequestJobPriceDto | null;
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

  @ApiProperty({
    description:
      'The garage usually answers the same day: its public rate is at or above the API’s threshold',
  })
  answersSameDay!: boolean;

  @ApiProperty({ enum: RECIPIENT_STATUSES })
  status!: RecipientStatus;

  @ApiProperty(NULLABLE_TIME)
  answeredAt!: string | null;

  // Only once the garage's 5-minute undo window has closed.
  @ApiProperty({ enum: DECLINE_REASON_CODES, nullable: true })
  declineReason!: DeclineReasonCode | null;

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

  @ApiProperty({
    description: 'What the driver wrote when cancelling, if anything',
    nullable: true,
    type: String,
  })
  cancelNote!: string | null;

  @ApiProperty({
    description:
      'Cancelled by the driver less than the free-cancel cutoff before the start; never a penalty',
  })
  lateCancellation!: boolean;

  @ApiProperty(NULLABLE_TIME)
  noShowAt!: string | null;

  @ApiProperty(NULLABLE_TIME)
  completedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

// The booking a list row needs to say where it stands.
export class RequestBookingDto {
  @ApiProperty({ enum: BOOKING_STATUSES })
  status!: BookingStatus;

  @ApiProperty({ format: 'date-time' })
  confirmBy!: string;

  @ApiProperty({ format: 'date-time' })
  startsAt!: string;
}

// The driver's row also needs what its cancel turns on: the booking to call,
// the garage the dialog names, who cancelled it, whether late, and whether
// its job has started.
export class DriverRowBookingDto extends RequestBookingDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: GarageRefDto })
  garage!: GarageRefDto;

  @ApiProperty({ enum: CANCELLED_BY_SIDES, nullable: true })
  cancelledBySide!: CancelledBySide | null;

  @ApiProperty({
    description:
      'Cancelled by the driver less than the free-cancel cutoff before the start; never a penalty',
  })
  lateCancellation!: boolean;

  @ApiProperty({
    description: 'When the garage recorded that the driver did not come',
    ...NULLABLE_TIME,
  })
  noShowAt!: string | null;

  @ApiProperty({
    description: 'The booking’s job exists and has left to do',
  })
  jobStarted!: boolean;

  @ApiProperty({
    description: 'The final price recorded at the handover, in bani',
    nullable: true,
    type: Number,
  })
  finalPriceBani!: number | null;

  @ApiProperty({
    ...NULLABLE_TIME,
    description: 'When the car was handed over',
  })
  handedOverAt!: string | null;
}

// The driver's request page also shows the price paid at the handover.
export class DriverBookingDto extends BookingDto {
  @ApiProperty({
    description: 'The final price recorded at the handover, in bani',
    nullable: true,
    type: Number,
  })
  finalPriceBani!: number | null;

  @ApiProperty({
    ...NULLABLE_TIME,
    description: 'When the car was handed over',
  })
  handedOverAt!: string | null;
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

  @ApiProperty({
    description: 'The request’s newest booking',
    nullable: true,
    type: DriverRowBookingDto,
  })
  booking!: DriverRowBookingDto | null;
}

export class RequestDto extends OmitType(RequestSummaryDto, ['booking']) {
  @ApiProperty({ type: [RecipientDto] })
  recipients!: RecipientDto[];

  @ApiProperty({ type: [QuoteDto] })
  quotes!: QuoteDto[];

  @ApiProperty({ nullable: true, type: DriverBookingDto })
  declare booking: DriverBookingDto | null;
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

// The garage's one reason for not taking a request.
export class DeclineRequestDto {
  @ApiProperty({ enum: DECLINE_REASON_CODES })
  @IsIn(DECLINE_REASON_CODES)
  reason!: DeclineReasonCode;
}

export class GarageQuoteDto extends OmitType(QuoteDto, ['garage'] as const) {}

export class BookingMechanicDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class GarageBookingDto extends OmitType(BookingDto, [
  'garage',
] as const) {
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  confirmedBy!: string | null;

  @ApiProperty({
    description: 'The account that recorded the no-show',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  noShowRecordedBy!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  mechanicId!: string | null;

  @ApiProperty({
    description:
      "Who does the job: the booking's mechanic, or the owner's own row when the garage works without a team",
    nullable: true,
    type: BookingMechanicDto,
  })
  mechanic!: BookingMechanicDto | null;

  @ApiProperty({ nullable: true, type: Number })
  lift!: number | null;

  @ApiProperty()
  moveCount!: number;

  @ApiProperty()
  historyShared!: boolean;

  @ApiProperty({
    description:
      "A confirmed booking still ahead whose mechanic's card was taken off the team, or that falls on one of her days off or outside her working hours: the garage gives it to someone else",
  })
  toReassign!: boolean;
}

// The booking a garage's row needs: when, how long, who and where.
export class GarageRowBookingDto extends RequestBookingDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  durationMinutes!: number;

  @ApiProperty({ nullable: true, type: BookingMechanicDto })
  mechanic!: BookingMechanicDto | null;

  @ApiProperty({ nullable: true, type: Number })
  lift!: number | null;

  @ApiProperty({
    description:
      "A confirmed booking still ahead whose mechanic's card was taken off the team, or that falls on one of her days off or outside her working hours: the garage gives it to someone else",
  })
  toReassign!: boolean;

  @ApiProperty({
    description: 'When the garage recorded that the driver did not come',
    ...NULLABLE_TIME,
  })
  noShowAt!: string | null;

  @ApiProperty({
    description:
      "The reader may record a no-show: a confirmed booking whose time has come and whose job has not started, read by the owner, the desk or the booking's own mechanic",
  })
  canRecordNoShow!: boolean;

  @ApiProperty({
    description:
      'The reader may withdraw the no-show: recorded today, Bucharest time, by the same readers',
  })
  canWithdrawNoShow!: boolean;
}

export class GarageRequestSummaryDto extends PickType(RequestSummaryDto, [
  'id',
  'status',
  'createdAt',
  'expiresAt',
] as const) {
  @ApiProperty({
    description:
      'The plate shows to the owner and the desk once the booking is confirmed',
    type: GarageCarDto,
  })
  car!: GarageCarDto;

  @ApiProperty({ type: [GarageRequestJobDto] })
  jobs!: GarageRequestJobDto[];

  @ApiProperty({
    description: "The description's first line",
    nullable: true,
    type: String,
  })
  descriptionLine!: string | null;

  @ApiProperty({
    description:
      'Set when the request no longer waits for the garage: on the rows of a closed read, and on the detail',
    enum: GARAGE_CLOSE_REASONS,
    nullable: true,
  })
  closedReason!: GarageCloseReason | null;

  @ApiProperty({
    ...NULLABLE_TIME,
    description: 'Set with closedReason on list rows only; null on the detail',
  })
  closedAt!: string | null;

  @ApiProperty({
    description:
      "What became of the garage's quote; set on the quoted read, null elsewhere",
    enum: QUOTE_OUTCOMES,
    nullable: true,
  })
  outcome!: QuoteOutcome | null;

  @ApiProperty({
    description:
      'The phone shows to the owner and the desk on a row whose quote the driver accepted, while the booking waits for confirmation or is confirmed',
    type: GarageDriverDto,
  })
  driver!: GarageDriverDto;

  @ApiProperty({ type: GarageRecipientDto })
  recipient!: GarageRecipientDto;

  @ApiProperty({ nullable: true, type: GarageQuoteDto })
  quote!: GarageQuoteDto | null;

  @ApiProperty({
    description: 'The booking the garage’s quote became',
    nullable: true,
    type: GarageRowBookingDto,
  })
  booking!: GarageRowBookingDto | null;
}

export class GarageRequestDto extends OmitType(GarageRequestSummaryDto, [
  'driver',
  'car',
  'booking',
] as const) {
  @ApiProperty({ type: GarageDriverDto })
  driver!: GarageDriverDto;

  @ApiProperty({ type: GarageCarDto })
  car!: GarageCarDto;

  @ApiProperty({ type: [GarageRequestDetailJobDto] })
  declare jobs: GarageRequestDetailJobDto[];

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({
    description: 'The booking the garage’s quote became',
    nullable: true,
    type: GarageBookingDto,
  })
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

const trimmedOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

// A garage's answer to a request: a price range in whole lei, how long the
// work takes and when the car can come in.
export class SendQuoteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  requestId!: string;

  @ApiProperty({ maximum: QUOTE_LEI_MAX, minimum: QUOTE_LEI_MIN })
  @IsInt()
  @Min(QUOTE_LEI_MIN)
  @Max(QUOTE_LEI_MAX)
  fromLei!: number;

  @ApiProperty({ maximum: QUOTE_LEI_MAX, minimum: QUOTE_LEI_MIN })
  @IsInt()
  @Min(QUOTE_LEI_MIN)
  @Max(QUOTE_LEI_MAX)
  toLei!: number;

  @ApiProperty({
    maximum: QUOTE_DURATION_MAX_MINUTES,
    minimum: QUOTE_DURATION_MIN_MINUTES,
    multipleOf: QUOTE_DURATION_MIN_MINUTES,
  })
  @IsInt()
  @Min(QUOTE_DURATION_MIN_MINUTES)
  @Max(QUOTE_DURATION_MAX_MINUTES)
  @IsDivisibleBy(QUOTE_DURATION_MIN_MINUTES)
  durationMinutes!: number;

  @ApiProperty({
    description: 'The proposed start, with its offset; later than now',
    format: 'date-time',
  })
  @IsISO8601({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  slot!: string;

  @ApiPropertyOptional({
    description: 'Whitespace alone is no note',
    maxLength: QUOTE_NOTE_MAX,
    nullable: true,
    type: String,
  })
  @Transform(trimmedOrNull)
  @IsOptional()
  @IsString()
  @Length(1, QUOTE_NOTE_MAX)
  note?: string | null;
}

// Why the driver cancels a booking, and what they add, if anything; the
// garage reads both.
export class CancelBookingDto {
  @ApiProperty({ enum: DRIVER_CANCEL_REASONS })
  @IsIn(DRIVER_CANCEL_REASONS)
  reason!: DriverCancelReasonCode;

  @ApiPropertyOptional({
    description: 'Counted after trimming; whitespace alone is no note',
    maxLength: BOOKING_CANCEL_NOTE_MAX,
    nullable: true,
    type: String,
  })
  @Transform(trimmedOrNull)
  @IsOptional()
  @IsString()
  @Length(1, BOOKING_CANCEL_NOTE_MAX)
  // Line breaks and tabs are text; any other control character is refused,
  // NUL first, which PostgreSQL cannot store.
  @Matches(/^(?:\P{Cc}|[\t\n\r])*$/u, {
    message: 'note must not hold control characters',
  })
  note?: string | null;
}

// The garage's choices when it confirms a booking. A null is no choice: the
// field is left out instead.
export class ConfirmBookingDto {
  @ApiPropertyOptional({
    description:
      "Required while the garage's team is on; refused while it is off",
    format: 'uuid',
  })
  @ValidateIf((dto: ConfirmBookingDto) => dto.mechanicId !== undefined)
  @IsUUID()
  mechanicId?: string;

  @ApiPropertyOptional({
    description:
      "1 to the garage's lift count; refused while it schedules without lifts",
    maximum: LIFT_MAX,
    minimum: 1,
  })
  @ValidateIf((dto: ConfirmBookingDto) => dto.lift !== undefined)
  @IsInt()
  @Min(1)
  @Max(LIFT_MAX)
  lift?: number;
}

export class ConfirmOptionsDto {
  @ApiProperty({ description: '0 while the garage schedules without lifts' })
  liftCount!: number;

  @ApiProperty({
    description: 'Empty while the garage works without a team',
    type: [BookingMechanicDto],
  })
  mechanics!: BookingMechanicDto[];

  @ApiProperty({
    description:
      'Whether a confirm must name a mechanic: true while the garage works with a team, even before it has one',
  })
  mechanicRequired!: boolean;

  @ApiProperty({
    description:
      "Whether any of the quote's jobs is done on a lift: the dialog offers a lift first, the confirm still accepts none",
  })
  needsLift!: boolean;
}

const SCHEDULE_DAY = /^\d{4}-\d{2}-\d{2}$/;

// The garage's schedule over one to seven Bucharest days.
export class ScheduleQueryDto {
  @ApiPropertyOptional({
    description: 'YYYY-MM-DD, Bucharest; today when left out',
    format: 'date',
  })
  @IsOptional()
  @Matches(SCHEDULE_DAY)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    description: 'YYYY-MM-DD, Bucharest; from when left out, at most 6 days on',
    format: 'date',
  })
  @IsOptional()
  @Matches(SCHEDULE_DAY)
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lift?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  mechanicId?: string;
}

// One stretch of work of a confirmed booking.
export class BookingSegmentDto {
  @ApiProperty({ format: 'date-time' })
  startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  endsAt!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  mechanicId!: string | null;

  @ApiPropertyOptional({
    description: 'Present only while the garage schedules with lifts',
    nullable: true,
    type: Number,
  })
  lift?: number | null;
}

export class ScheduleCarDto {
  @ApiProperty()
  brand!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;
}

export class GarageScheduleEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: ScheduleCarDto })
  car!: ScheduleCarDto;

  @ApiProperty({ description: "In the caller's language", type: [String] })
  jobs!: string[];

  @ApiProperty({ description: 'The driver\'s short name: "Dan V."' })
  customer!: string;

  @ApiProperty({ nullable: true, type: BookingMechanicDto })
  mechanic!: BookingMechanicDto | null;

  @ApiPropertyOptional({
    description: 'Present only while the garage schedules lifts',
    nullable: true,
    type: Number,
  })
  lift?: number | null;

  @ApiProperty({ format: 'date-time' })
  startsAt!: string;

  @ApiProperty()
  durationMinutes!: number;

  @ApiProperty({
    enum: ['awaiting_confirmation', 'confirmed', 'completed', 'no_show'],
  })
  status!: 'awaiting_confirmation' | 'confirmed' | 'completed' | 'no_show';

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  confirmBy!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  minutesLeft!: number | null;

  @ApiProperty({
    description: "The job's status, null before the confirmation",
    nullable: true,
    type: String,
  })
  jobStatus!: string | null;

  @ApiProperty({
    description: 'Empty while the booking awaits the garage',
    type: [BookingSegmentDto],
  })
  segments!: BookingSegmentDto[];
}

// One opening interval of a day, on the Bucharest wall clock.
export class ScheduleIntervalDto {
  @ApiProperty({ example: '08:30' })
  from!: string;

  @ApiProperty({ example: '17:00' })
  to!: string;
}

// A day of the read's range and when the garage is open on it: none on a
// closed day, a public holiday or while the garage has set no hours.
export class ScheduleDayDto {
  @ApiProperty({ example: '2026-10-09' })
  day!: string;

  @ApiProperty({ type: [ScheduleIntervalDto] })
  open!: ScheduleIntervalDto[];
}

export class GarageScheduleDto {
  @ApiProperty({ type: [GarageScheduleEntryDto] })
  entries!: GarageScheduleEntryDto[];

  // The blocked time staff read, filtered as the entries are.
  // A thunk: time-blocks.dto imports this file.
  @ApiProperty({ type: () => [TimeBlockDto] })
  blocks!: TimeBlockDto[];

  @ApiProperty()
  from!: string;

  @ApiProperty()
  to!: string;

  @ApiProperty()
  lifts!: boolean;

  @ApiProperty({ description: "The garage's lifts; 0 while lifts is false" })
  liftCount!: number;

  @ApiProperty({ description: 'Whether the garage has set opening hours' })
  hoursSet!: boolean;

  @ApiProperty({ type: [ScheduleDayDto] })
  days!: ScheduleDayDto[];
}

// The driver's acceptance of a quote: whether the garage may read the car's
// history once it confirms.
export class AcceptQuoteDto {
  @ApiPropertyOptional({ default: false })
  @ValidateIf((dto: AcceptQuoteDto) => dto.historyShared !== undefined)
  @IsBoolean()
  historyShared?: boolean;
}

// The driver's decline of one waiting quote.
export class DeclinedQuoteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['declined_by_driver'] })
  status!: 'declined_by_driver';

  @ApiProperty({ format: 'date-time' })
  declinedAt!: string;
}

// A garage as the driver's comparison shows it: no phone, address or e-mail.
export class CompareGarageDto extends GarageRefDto {
  @ApiProperty({
    description: 'One decimal; null until the garage is reviewed',
    nullable: true,
    type: Number,
  })
  rating!: number | null;

  @ApiProperty()
  reviewCount!: number;

  @ApiProperty({
    description: 'The garage’s city; null when unknown',
    nullable: true,
    type: String,
  })
  area!: string | null;

  @ApiProperty({ description: 'A mobile mechanic' })
  mobile!: boolean;
}

export class CompareQuoteJobDto extends QuoteJobDto {
  @ApiProperty()
  nameRo!: string;

  @ApiProperty()
  nameEn!: string;
}

const COMPARE_QUOTE_STATUSES = QUOTE_STATUSES.filter(
  (status) => status !== 'withdrawn',
);

export class CompareQuoteDto extends PickType(QuoteDto, [
  'id',
  'fromBani',
  'toBani',
  'durationMinutes',
  'slot',
  'note',
  'sentAt',
  'changedAt',
  'expiresAt',
] as const) {
  @ApiProperty({ type: CompareGarageDto })
  garage!: CompareGarageDto;

  @ApiProperty({ enum: COMPARE_QUOTE_STATUSES })
  status!: Exclude<QuoteStatus, 'withdrawn'>;

  @ApiProperty({ type: [CompareQuoteJobDto] })
  jobs!: CompareQuoteJobDto[];
}

const WITHDRAWN_REASONS = ['garage', 'suspended'] as const;

export class WithdrawnQuoteDto {
  @ApiProperty()
  garageName!: string;

  @ApiProperty({ enum: WITHDRAWN_REASONS })
  reason!: (typeof WITHDRAWN_REASONS)[number];
}

export class DeclinedGarageDto {
  @ApiProperty()
  garageName!: string;

  @ApiProperty({ enum: DECLINE_REASON_CODES })
  declineReason!: DeclineReasonCode;
}

// The comparison's booking: which quote it holds and, once confirmed, who
// does the job.
export class CompareBookingDto extends RequestBookingDto {
  @ApiProperty({ format: 'uuid' })
  quoteId!: string;

  @ApiProperty({
    description: 'The confirmed booking’s mechanic; null until one is named',
    nullable: true,
    type: String,
  })
  mechanicName!: string | null;
}

export class CompareRequestDto extends PickType(RequestSummaryDto, [
  'id',
  'status',
  'jobs',
  'car',
] as const) {
  @ApiProperty({ nullable: true, type: CompareBookingDto })
  booking!: CompareBookingDto | null;

  @ApiProperty({
    description: 'The description’s first line',
    nullable: true,
    type: String,
  })
  description!: string | null;
}

export class QuoteComparisonDto {
  @ApiProperty({ type: CompareRequestDto })
  request!: CompareRequestDto;

  @ApiProperty({
    description: 'Fastest answer first, equal times by id',
    type: [CompareQuoteDto],
  })
  quotes!: CompareQuoteDto[];

  @ApiProperty({ type: [WithdrawnQuoteDto] })
  withdrawn!: WithdrawnQuoteDto[];

  @ApiProperty({
    description: 'Declines past the garage’s undo window',
    type: [DeclinedGarageDto],
  })
  declined!: DeclinedGarageDto[];

  @ApiProperty({
    description: 'Names of the garages that have not answered yet',
    type: [String],
  })
  waiting!: string[];
}
