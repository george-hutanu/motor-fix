import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { DAY_OFF_NOTE_MAX, type WeeklyHours } from './garage-hours';
import {
  CERTIFICATION_MAX,
  CERTIFICATIONS_MAX,
  MECHANIC_CARD_NAME_MAX,
  MECHANIC_NAME_MIN,
  ROLE_TITLE_MAX,
  SPECIALTIES_MAX,
  TAG_MAX,
  YEARS_MAX,
} from './listing-sections';
import { StaffInviteOnCardDto } from './staff-invite.dto';

export class GarageMechanicDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  // The specialties joined with ", ", for the readers of one line.
  @ApiProperty({ nullable: true, type: String })
  speciality!: string | null;

  @ApiProperty({ nullable: true, type: String })
  roleTitle!: string | null;

  @ApiProperty({ type: [String] })
  specialties!: string[];

  @ApiProperty({ type: [String] })
  certifications!: string[];

  @ApiProperty({ nullable: true, type: Number })
  years!: number | null;

  @ApiProperty({ format: 'uuid', type: [String] })
  brandIds!: string[];

  // The garage owner's own row: edited, never removed.
  @ApiProperty()
  isOwner!: boolean;

  // Confirmed bookings on this card still to come.
  @ApiProperty()
  futureBookings!: number;

  // The mechanic's own consent to appear on the profile.
  @ApiProperty()
  onProfile!: boolean;

  @ApiProperty()
  hasAccount!: boolean;

  // Whether the public profile shows this card now, by the one rule.
  @ApiProperty()
  shown!: boolean;

  // Whether a driver may ask for this mechanic by name.
  @ApiProperty()
  takesDirectRequests!: boolean;

  // One decimal ("4.9"); null exactly when no review counts.
  @ApiProperty({ example: '4.9', nullable: true, type: String })
  rating!: string | null;

  @ApiProperty()
  reviewCount!: number;

  // The card's newest sent invite, expired or not.
  @ApiProperty({ nullable: true, type: StaffInviteOnCardDto })
  invite!: StaffInviteOnCardDto | null;
}

// A brand the garage works on, offered in the card's brand list.
export class GarageBrandOptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class GarageMechanicsDto {
  @ApiProperty({ type: [GarageMechanicDto] })
  items!: GarageMechanicDto[];

  // The garage's works_on brands, A to Z.
  @ApiProperty({ type: [GarageBrandOptionDto] })
  brands!: GarageBrandOptionDto[];

  // The garage's switch over the whole team on the public profile.
  @ApiProperty()
  teamOnProfile!: boolean;
}

// The fields of a card the owner writes. The limits are judged by the
// service, which answers 422 with every problem at once; `@Allow` only lets
// each field through the global whitelist. The photo, the bio and the
// languages, and the consent to appear on the profile, are the mechanic's and
// are refused with 403 mechanic_owned_field.
class MechanicCardFieldsDto {
  @ApiPropertyOptional({
    description: 'null clears it',
    maxLength: ROLE_TITLE_MAX,
    nullable: true,
    type: String,
  })
  @Allow()
  roleTitle?: string | null;

  @ApiPropertyOptional({
    description: `At most ${SPECIALTIES_MAX}, each 1 to ${TAG_MAX} characters once trimmed; [] clears them`,
    type: [String],
  })
  @Allow()
  specialties?: string[];

  @ApiPropertyOptional({
    description: `At most ${CERTIFICATIONS_MAX}, each 1 to ${CERTIFICATION_MAX} characters once trimmed; [] clears them`,
    type: [String],
  })
  @Allow()
  certifications?: string[];

  @ApiPropertyOptional({
    description: 'null clears it',
    maximum: YEARS_MAX,
    minimum: 0,
    nullable: true,
    type: 'integer',
  })
  @Allow()
  years?: number | null;

  @ApiPropertyOptional({
    description: 'Brands the garage works on, each once',
    format: 'uuid',
    type: [String],
  })
  @Allow()
  brandIds?: string[];

  // Let through so the service can refuse them with their own code.
  @Allow()
  photo?: never;

  @Allow()
  bio?: never;

  @Allow()
  languages?: never;

  @Allow()
  onProfile?: never;
}

export class CreateMechanicDto extends MechanicCardFieldsDto {
  @ApiProperty({
    maxLength: MECHANIC_CARD_NAME_MAX,
    minLength: MECHANIC_NAME_MIN,
  })
  @Allow()
  name!: string;
}

// Omitted fields stay as they are.
export class UpdateMechanicDto extends MechanicCardFieldsDto {
  @ApiPropertyOptional({
    maxLength: MECHANIC_CARD_NAME_MAX,
    minLength: MECHANIC_NAME_MIN,
  })
  @Allow()
  name?: string;

  // Not on a new card, which takes direct requests until the owner says not.
  @ApiPropertyOptional({
    description: 'Whether a driver may ask for this mechanic by name',
    type: Boolean,
  })
  @Allow()
  takesDirectRequests?: boolean;
}

const WEEK_SCHEMA = {
  additionalProperties: {
    items: {
      items: { type: 'string' },
      maxItems: 2,
      minItems: 2,
      type: 'array',
    },
    type: 'array',
  },
  type: 'object',
} as const;

export class MechanicDayOffDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'The first day off, a Bucharest day',
    format: 'date',
  })
  firstDay!: string;

  @ApiProperty({
    description: 'The last day off, the first one or later',
    format: 'date',
  })
  lastDay!: string;

  @ApiProperty({ maxLength: DAY_OFF_NOTE_MAX, nullable: true, type: String })
  note!: string | null;
}

export class MechanicScheduleDto {
  @ApiProperty({
    ...WEEK_SCHEMA,
    description:
      'Each weekday (mon…sun) to the stretch the mechanic works, as one "HH:MM" pair, or an empty list; the garage\'s weekdays while isDefault',
  })
  workingHours!: WeeklyHours;

  @ApiProperty({ description: 'Whether the Saturday stretch counts' })
  worksSaturdays!: boolean;

  @ApiProperty({
    description: "True until the owner first saves this mechanic's hours",
  })
  isDefault!: boolean;

  @ApiProperty({
    description: 'The days off ending today or later, by first day',
    type: [MechanicDayOffDto],
  })
  daysOff!: MechanicDayOffDto[];

  @ApiProperty({
    ...WEEK_SCHEMA,
    description: "The garage's own weekly hours: the bound of every stretch",
  })
  garageHours!: WeeklyHours | Record<string, never>;
}

export class UpdateMechanicHoursDto {
  @ApiProperty({
    ...WEEK_SCHEMA,
    description:
      'All seven weekdays, each an empty list or one "HH:MM" pair on the 15-minute grid inside the garage\'s span of that day',
  })
  @Allow()
  workingHours!: WeeklyHours;

  @ApiProperty()
  @Allow()
  worksSaturdays!: boolean;
}

export class AddMechanicDayOffDto {
  @ApiProperty({
    description: 'Today or later, a Bucharest day',
    format: 'date',
  })
  @Allow()
  firstDay!: string;

  @ApiPropertyOptional({
    description: 'The first day by default; at most 365 days ahead',
    format: 'date',
  })
  @Allow()
  lastDay?: string;

  @ApiPropertyOptional({
    maxLength: DAY_OFF_NOTE_MAX,
    nullable: true,
    type: String,
  })
  @Allow()
  note?: string | null;

  @ApiPropertyOptional({
    description: 'Save even over confirmed bookings on those days',
  })
  @Allow()
  acknowledgeBookings?: boolean;
}

export class DayOffBookingDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  startsAt!: string;
}

export class DaysOffBookingsRefusalDto {
  @ApiProperty({ enum: ['bookings_on_days_off'] })
  code!: 'bookings_on_days_off';

  @ApiProperty()
  message!: string;

  @ApiProperty({ type: [DayOffBookingDto] })
  bookings!: DayOffBookingDto[];
}
