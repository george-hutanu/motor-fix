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
  ValidateIf,
} from 'class-validator';

import {
  DELETED_AUTHOR,
  PAID_BANI_MAX,
  REVIEW_REPLY_TEXT_MAX,
  REVIEW_REPORT_REASONS,
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

const REVIEW_REPLY_STATUSES = ['published', 'reported', 'removed'] as const;
export type ReviewReplyStatus = (typeof REVIEW_REPLY_STATUSES)[number];

// Why the owner may not post or edit a reply; an edit of a review with no
// reply is a 404.
export type ReplyRefusal =
  | 'review_not_public'
  | 'reply_removed'
  | 'already_replied'
  | 'reply_not_public';

// Only the type is checked here: the length is the service's 422, after the
// 409s.
export class ReplyToReviewDto {
  @ApiProperty({
    description: '1 to 1,000 characters after the trim',
    maxLength: REVIEW_REPLY_TEXT_MAX,
  })
  // PostgreSQL cannot store a NUL character, so it goes before the trim.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replaceAll('\u0000', '').trim() : value,
  )
  @IsString()
  text!: string;
}

// The garage's reply to a review as the garage's own staff read it.
export class ReviewReplyDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  text!: string;

  @ApiProperty({ format: 'date-time' })
  postedAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  editedAt!: string | null;

  @ApiProperty({ enum: REVIEW_REPLY_STATUSES })
  status!: ReviewReplyStatus;
}

// The garage's reply as the public reads it: published only, and nothing of
// who posted it.
export class PublicReviewReplyDto {
  @ApiProperty()
  text!: string;

  @ApiProperty({ format: 'date-time' })
  postedAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  editedAt!: string | null;
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

  @ApiProperty({
    description: "The garage's published reply",
    nullable: true,
    type: PublicReviewReplyDto,
  })
  reply!: PublicReviewReplyDto | null;
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

  @ApiProperty({
    description: "The garage's published reply",
    nullable: true,
    type: PublicReviewReplyDto,
  })
  reply!: PublicReviewReplyDto | null;
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

export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

// Each report reason as the admins read it, in both languages.
export const REVIEW_REPORT_REASON_TEXTS: Record<
  ReviewReportReason,
  { en: string; ro: string }
> = {
  ads: { en: 'Advertising', ro: 'Reclamă' },
  fake_or_conflicted: {
    en: 'Fake or conflict of interest',
    ro: 'Falsă sau în conflict de interese',
  },
  hate: { en: 'Hate or discrimination', ro: 'Ură sau discriminare' },
  insults: { en: 'Insults', ro: 'Insulte' },
  off_topic: { en: 'Off topic', ro: 'În afara subiectului' },
  other: { en: 'Other', ro: 'Altceva' },
  personal_data: { en: 'Personal data', ro: 'Date personale' },
  promotion: { en: 'Promoting another garage', ro: 'Promovarea altui service' },
  threats_or_legal_accusations: {
    en: 'Threats or legal accusations',
    ro: 'Amenințări sau acuzații legale',
  },
};

// Why a review may not be reported again.
const REPORT_REFUSALS = ['already_reported', 'already_kept'] as const;
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
  // Absent is fine; null is a malformed body (400), as any other non-string.
  @ValidateIf((_, value) => value !== undefined)
  // PostgreSQL cannot store a NUL character, so it goes before the trim.
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.replaceAll('\u0000', '').trim() || undefined
      : value,
  )
  @IsString()
  text?: string;
}

// The rules an admin may remove a review or a reply for: every report reason
// but other, which names no rule.
const REVIEW_REMOVAL_REASONS = REVIEW_REPORT_REASONS.filter(
  (reason) => reason !== 'other',
) as readonly Exclude<ReviewReportReason, 'other'>[];
export type ReviewRemovalReason = (typeof REVIEW_REMOVAL_REASONS)[number];

// Why a decision was refused once nothing was written.
const DECISION_REFUSALS = ['already_decided', 'no_pending_report'] as const;
export type DecisionRefusal = (typeof DECISION_REFUSALS)[number];

export class ReviewDecisionDto {
  @ApiProperty({ enum: ['remove'] })
  @IsIn(['remove'])
  decision!: 'remove';

  @ApiProperty({
    description: 'The rule broken; the report reasons without other',
    enum: REVIEW_REMOVAL_REASONS,
  })
  @IsIn(REVIEW_REMOVAL_REASONS)
  reason!: ReviewRemovalReason;
}

export class ReviewDecisionResultDto {
  @ApiProperty({ format: 'uuid' })
  reviewId!: string;

  @ApiProperty({ format: 'uuid' })
  reportId!: string;

  @ApiProperty({ enum: ['review', 'reply'] })
  target!: 'review' | 'reply';

  @ApiProperty({ enum: ['removed'] })
  decision!: 'removed';

  @ApiProperty({ format: 'date-time' })
  decidedAt!: string;

  @ApiProperty({
    description: 'The reply the decision removed; null when none was touched',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  replyId!: string | null;
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

// A mechanic as a review names them on the garage's own page: by short name.
export class ReviewMechanicDto {
  @ApiProperty({ example: 'Costel R.' })
  shortName!: string;
}

// A review as the garage's own staff read it: the public row plus where it
// stands, the mechanic who did the job, and whether the caller may reply to it
// or report it.
export class GarageStaffReviewDto extends GarageReviewDto {
  @ApiProperty({ enum: ['published', 'reported'] })
  status!: 'published' | 'reported';

  @ApiProperty({
    description: 'A job review’s mechanic; a profile review names none',
    nullable: true,
    type: ReviewMechanicDto,
  })
  mechanic!: ReviewMechanicDto | null;

  @ApiProperty({
    description: 'The reply, published or reported; a removed one is null',
    nullable: true,
    type: ReviewReplyDto,
  })
  override reply: ReviewReplyDto | null = null;

  @ApiProperty()
  canReply!: boolean;

  @ApiProperty()
  canReport!: boolean;

  @ApiProperty({
    description:
      'Why the owner may not report the review now, as the report operation would refuse it; null when it may',
    enum: REPORT_REFUSALS,
    nullable: true,
    type: String,
  })
  reportRefusal!: ReportRefusal | null;
}

export class GarageStaffReviewsPageDto {
  @ApiProperty({
    description: "The garage's stored rating, as its profile shows it",
    nullable: true,
    type: Number,
  })
  rating!: number | null;

  @ApiProperty({ description: "The garage's stored review count" })
  reviewCount!: number;

  @ApiProperty({
    description: 'Published reviews only, as the profile counts them',
    type: RatingBreakdownDto,
  })
  breakdown!: RatingBreakdownDto;

  @ApiProperty({ description: "The garage's public profile address" })
  slug!: string;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty({ description: 'Published and reported reviews' })
  total!: number;

  @ApiProperty({ type: [GarageStaffReviewDto] })
  items!: GarageStaffReviewDto[];
}

// The admins' queue of pending review reports: oldest first, 20 a
// page. Nothing in it names an account's e-mail, phone, plate or id.
export const REVIEW_REPORT_QUEUE_PAGE = 20;

const REVIEW_REPORT_SOURCES = ['garage', 'author', 'automatic'] as const;
type ReviewReportSource = (typeof REVIEW_REPORT_SOURCES)[number];

export class ReportQueueQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, type: 'integer' })
  @IsOptional()
  @Transform(toQueryNumber)
  @IsInt()
  @Min(1)
  page?: number;
}

export class ReportQueueReportDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['review', 'reply'] })
  target!: 'review' | 'reply';

  @ApiProperty({ enum: REVIEW_REPORT_REASONS })
  reason!: ReviewReportReason;

  @ApiPropertyOptional({
    description: 'What the reporter wrote; only with the reason other',
    nullable: true,
    type: String,
  })
  text?: string | null;

  @ApiProperty({ enum: REVIEW_REPORT_SOURCES })
  source!: ReviewReportSource;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    description: 'When an admin is due to decide',
    format: 'date-time',
  })
  dueAt!: string;

  @ApiProperty({ description: 'Due already: now is at or past dueAt' })
  overdue!: boolean;
}

export class ReportQueueGarageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class ReportQueueReviewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maximum: 5, minimum: 1, type: 'integer' })
  score!: number;

  @ApiProperty({ nullable: true, type: String })
  text!: string | null;

  @ApiProperty({ enum: ['job', 'profile'] })
  source!: 'job' | 'profile';

  @ApiProperty({ format: 'date-time' })
  postedAt!: string;

  @ApiProperty({
    description: `The author's public short name, or "${DELETED_AUTHOR}"; never an identifier`,
  })
  author!: string;
}

export class ReportQueueReplyDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  text!: string;

  @ApiProperty({ format: 'date-time' })
  postedAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  editedAt!: string | null;

  @ApiProperty({ description: "The garage's name" })
  postedBy!: string;
}

export class ReportQueueJobFactDto {
  @ApiProperty({
    description:
      'confirmed: a review of a job done; none: written from the profile',
    enum: ['confirmed', 'none'],
  })
  kind!: 'confirmed' | 'none';

  @ApiPropertyOptional({
    description:
      "The accepted quote's work names in the reader's language, joined with ' · '; only when confirmed",
  })
  work?: string;

  @ApiPropertyOptional({ description: 'Brand and model; only when confirmed' })
  car?: string;

  @ApiPropertyOptional({
    description: 'When the car was handed over; null when it was not',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  handedOverAt?: string | null;
}

export class ReportQueueAccountFactDto {
  @ApiProperty({ description: "The author's account is deleted" })
  deleted!: boolean;

  @ApiPropertyOptional({
    description: 'When the account was created; absent when deleted',
    format: 'date-time',
  })
  createdAt?: string;
}

export class ReportQueueGarageReportsDto {
  @ApiProperty({
    description:
      'Reports by this garage on its reviews created before this one, any status',
    minimum: 0,
    type: 'integer',
  })
  earlier!: number;

  @ApiProperty({
    description: 'Of those, the ones an admin kept',
    minimum: 0,
    type: 'integer',
  })
  kept!: number;
}

export class ReportQueueFactsDto {
  @ApiProperty({ type: ReportQueueJobFactDto })
  job!: ReportQueueJobFactDto;

  @ApiProperty({ type: ReportQueueAccountFactDto })
  account!: ReportQueueAccountFactDto;

  @ApiProperty({
    description:
      "The author's other reviews, at any garage and not deleted by the author, with the same trimmed text",
    minimum: 0,
    type: 'integer',
  })
  identicalReviews!: number;

  @ApiProperty({ type: ReportQueueGarageReportsDto })
  garageReports!: ReportQueueGarageReportsDto;
}

export class ReportQueueItemDto {
  @ApiProperty({ type: ReportQueueReportDto })
  report!: ReportQueueReportDto;

  @ApiProperty({ type: ReportQueueGarageDto })
  garage!: ReportQueueGarageDto;

  @ApiProperty({ type: ReportQueueReviewDto })
  review!: ReportQueueReviewDto;

  @ApiPropertyOptional({
    description: 'Only when the report is on the reply',
    type: ReportQueueReplyDto,
  })
  reply?: ReportQueueReplyDto;

  @ApiProperty({ type: ReportQueueFactsDto })
  facts!: ReportQueueFactsDto;
}

export class ReportQueueDto {
  @ApiProperty({ type: [ReportQueueItemDto] })
  items!: ReportQueueItemDto[];

  @ApiProperty({ description: 'Pending reports', minimum: 0, type: 'integer' })
  total!: number;

  @ApiProperty({
    description: 'Of those, past their dueAt',
    minimum: 0,
    type: 'integer',
  })
  overdue!: number;

  @ApiProperty({
    description: 'When the oldest pending report was made; null when none',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  oldestCreatedAt!: string | null;

  @ApiProperty({ minimum: 1, type: 'integer' })
  page!: number;

  @ApiProperty({ enum: [REVIEW_REPORT_QUEUE_PAGE], type: 'integer' })
  pageSize!: number;
}
