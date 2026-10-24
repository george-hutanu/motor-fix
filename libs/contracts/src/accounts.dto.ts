import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateBy,
} from 'class-validator';

import {
  ACCOUNT_ROLES,
  ACCOUNT_STATES,
  type AccountRole,
  SEARCH_MAX,
} from './account-search';
import { calendarDay } from './cars.dto';

const COUNT_KIND = ['requests', 'reviews', 'age'] as const;
const STATUS = ['active', 'suspended'] as const;

export class AdminAccountsQueryDto {
  // The length is checked with the rest of the cursor, so a long one answers
  // invalid_cursor like any other cursor this list never gave out.
  @ApiPropertyOptional({
    description: 'The nextCursor of the previous page',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  // The values' rules (the length, the roles, one state) are the service's,
  // answered with their own codes; the edge checks only that they are text.
  @ApiPropertyOptional({
    description:
      'Contained in the name, a garage worked at or the e-mail, or a phone written in part; trimmed and spaces collapsed, ignored under 2 characters',
    maxLength: SEARCH_MAX,
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description:
      'Accounts holding at least one of these roles; repeated or comma-separated',
    enum: ACCOUNT_ROLES,
    isArray: true,
  })
  @IsOptional()
  @IsString({ each: true })
  role?: string | string[];

  @ApiPropertyOptional({
    description: 'watch matches none until open watches exist',
    enum: ACCOUNT_STATES,
  })
  @IsOptional()
  @IsString({ each: true })
  status?: string | string[];
}

export class AdminAccountCountDto {
  @ApiProperty({
    description:
      'requests for a driver, reviews for a garage or mechanic, age in days for a receptionist, an admin or an account under 7 days old',
    enum: COUNT_KIND,
  })
  kind!: (typeof COUNT_KIND)[number];

  @ApiProperty({ minimum: 0, type: 'integer' })
  value!: number;
}

// Nothing about the person beyond the name: no e-mail, phone or plate.
export class AdminAccountDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description: 'In the order driver, garage, receptionist, mechanic, admin',
    enum: ACCOUNT_ROLES,
    isArray: true,
  })
  roles!: AccountRole[];

  @ApiProperty({
    description:
      'The garage of the first role: owned, worked at as receptionist, or of the mechanic card',
    nullable: true,
    type: String,
  })
  garageName!: string | null;

  @ApiProperty({
    description:
      "True when the account's mechanic card is at a garage whose status is suspended",
  })
  serviceSuspended!: boolean;

  @ApiProperty({ description: 'Cars not removed', minimum: 0, type: 'integer' })
  carsCount!: number;

  @ApiProperty({ enum: STATUS })
  status!: (typeof STATUS)[number];

  @ApiProperty({
    description:
      'When the state began: creation for active, the last recorded suspension for suspended (null when none is recorded)',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  since!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: AdminAccountCountDto })
  count!: AdminAccountCountDto;
}

export class AdminAccountsPageDto {
  @ApiProperty({
    description: 'Newest first, 20 at most',
    type: [AdminAccountDto],
  })
  items!: AdminAccountDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiPropertyOptional({
    description:
      'Every account the search and filters match, counted at this read; only when q, role or status is given',
    minimum: 0,
    type: 'integer',
  })
  total?: number;
}

// Counted at most once a minute, the same for every language.
export class AdminAccountsSummaryDto {
  @ApiProperty({
    description: 'Active driver accounts used in the last 30 days',
    minimum: 0,
    type: 'integer',
  })
  activeDrivers!: number;

  @ApiProperty({
    description: 'Garages approved and listed now',
    minimum: 0,
    type: 'integer',
  })
  garagesListed!: number;

  @ApiProperty({
    description: 'Mechanic cards with an account at listed garages',
    minimum: 0,
    type: 'integer',
  })
  mechanics!: number;
}

const SIGN_IN_METHODS = [
  'password',
  'google',
  'apple',
  'whatsapp_phone',
] as const;
const GARAGE_STATUS = ['draft', 'approved', 'suspended'] as const;
const GARAGE_RELATION = ['owner', 'receptionist', 'mechanic'] as const;
const EMAIL_OUTCOME = ['sent', 'none', 'failed'] as const;

export const SUSPEND_REASON_MIN = 10;
export const ACCOUNT_NOTE_MAX = 500;
export const DATA_REQUEST_REFERENCE = /^DR-\d{4}-\d{4,}$/;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Today as Bucharest reads it, YYYY-MM-DD.
export const bucharestToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
  }).format(now);

const notAfterToday = () =>
  ValidateBy({
    name: 'notAfterToday',
    validator: {
      defaultMessage: (args) =>
        `${args?.property} must not be after today in Bucharest`,
      validate: (value) =>
        typeof value === 'string' && value <= bucharestToday(),
    },
  });

export class AdminAccountGarageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: GARAGE_STATUS })
  status!: (typeof GARAGE_STATUS)[number];

  @ApiProperty({ enum: GARAGE_RELATION })
  relation!: (typeof GARAGE_RELATION)[number];
}

export class AdminAccountCountsDto {
  @ApiProperty({ description: 'Cars not removed', minimum: 0, type: 'integer' })
  cars!: number;

  @ApiProperty({ minimum: 0, type: 'integer' })
  requests!: number;

  @ApiProperty({ minimum: 0, type: 'integer' })
  reviews!: number;
}

export class AdminAccountDocumentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'The document kind, as the legal panel names it',
  })
  kind!: string;

  @ApiProperty({ minimum: 0, type: 'integer' })
  pages!: number;

  @ApiProperty({
    description: 'Opened through the verification file page download route',
    format: 'uuid',
  })
  verificationFileId!: string;
}

// One account as the admin's page reads it: never a hash, a sign-in subject
// or a token.
export class AdminAccountPageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({ enum: ['ro', 'en'] })
  language!: 'ro' | 'en';

  @ApiProperty({
    description: 'In the order driver, garage, receptionist, mechanic, admin',
    enum: ACCOUNT_ROLES,
    isArray: true,
  })
  roles!: AccountRole[];

  @ApiProperty({ nullable: true, type: AdminAccountGarageDto })
  garage!: AdminAccountGarageDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  lastActiveAt!: string | null;

  @ApiProperty({ enum: STATUS })
  status!: (typeof STATUS)[number];

  @ApiProperty({ nullable: true, type: String })
  suspendedReason!: string | null;

  @ApiProperty({ type: AdminAccountCountsDto })
  counts!: AdminAccountCountsDto;

  @ApiProperty({ enum: SIGN_IN_METHODS, isArray: true })
  signInMethods!: (typeof SIGN_IN_METHODS)[number][];

  @ApiProperty({ description: 'Holds admin: no action is offered or taken' })
  isAdmin!: boolean;

  @ApiProperty({
    description: 'Holds an owner membership: deletion on request is refused',
  })
  isOwner!: boolean;

  @ApiProperty({
    description:
      "The owned garage's current legal documents; empty for a non-owner",
    type: [AdminAccountDocumentDto],
  })
  documents!: AdminAccountDocumentDto[];
}

export class AccessResetDto {
  @ApiProperty({
    description:
      'sent: the reset e-mail went out; none: no password or no e-mail; failed: the send was refused, the sessions still ended',
    enum: EMAIL_OUTCOME,
  })
  email!: (typeof EMAIL_OUTCOME)[number];
}

export class SuspendAccountDto {
  @ApiProperty({
    description: 'Trimmed; shown to the person in the e-mail',
    maxLength: ACCOUNT_NOTE_MAX,
    minLength: SUSPEND_REASON_MIN,
  })
  @Transform(trimmed)
  @IsString()
  @Length(SUSPEND_REASON_MIN, ACCOUNT_NOTE_MAX)
  reason!: string;
}

export class RestoreAccountDto {
  @ApiPropertyOptional({ description: 'Trimmed', maxLength: ACCOUNT_NOTE_MAX })
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(ACCOUNT_NOTE_MAX)
  note?: string;
}

export class DeleteAccountOnRequestDto {
  @ApiProperty({
    description: 'The data request reference',
    example: 'DR-2026-0001',
    pattern: DATA_REQUEST_REFERENCE.source,
  })
  @IsString()
  @Matches(DATA_REQUEST_REFERENCE, {
    message: 'reference must look like DR-2026-0001',
  })
  reference!: string;

  @ApiProperty({
    description: 'The day the request arrived, not after today in Bucharest',
    format: 'date',
  })
  @calendarDay()
  @notAfterToday()
  receivedOn!: string;

  @ApiProperty({ description: 'Must be true', enum: [true], type: Boolean })
  @Equals(true)
  identityChecked!: true;
}
