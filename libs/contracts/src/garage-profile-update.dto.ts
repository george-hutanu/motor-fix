import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Length,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  CLOSED_NOTE_MAX,
  type ClosedDay,
  closedDaysError,
  FACILITIES,
  FACILITIES_NOTE_MAX,
  type Facility,
  isFacilitiesNote,
  isWeeklyHours,
  type WeeklyHours,
} from './garage-hours';
import {
  PROFILE_DESCRIPTION_MAX,
  PROFILE_RADIUS_KM,
} from './garage-profile-limits';
import {
  atLeastOnePayment,
  CourtesyCarDto,
  PaymentMethodsDto,
} from './garage-settings.dto';
import {
  isRomanianPhone,
  NAME_MAX,
  NAME_MIN,
  trimmedWithin,
} from './listing-sections';
import { normalisePhone } from './phone';

const holds = (name: string, check: (value: unknown) => boolean) =>
  ValidateBy({
    name,
    validator: {
      defaultMessage: (args) => `${args?.property} is not valid`,
      validate: check,
    },
  });

// Only an absent field is skipped; a null one is judged, and refused.
const sentOnly = () => ValidateIf((_, value) => value !== undefined);

const textWithin = (min: number, max: number) => (value: unknown) =>
  typeof value === 'string' && trimmedWithin(value, min, max);

// The listing's step 5 facilities block, sent whole: whether the courtesy
// car's terms belong with the ticked facilities is the use case's to judge.
class FacilitiesGroupDto {
  @ApiProperty({
    description: 'Every facility the garage lists, once each',
    enum: FACILITIES,
    isArray: true,
    uniqueItems: true,
  })
  @IsArray()
  @IsIn(FACILITIES, { each: true })
  @ArrayUnique()
  facilities!: Facility[];

  @ApiPropertyOptional({
    description: 'Trimmed; empty or absent clears it; one line',
    maxLength: FACILITIES_NOTE_MAX,
  })
  @sentOnly()
  @holds('facilitiesNote', isFacilitiesNote)
  facilitiesNote?: string;

  @ApiPropertyOptional({
    description: 'Exactly when facilities lists courtesy_car',
    type: CourtesyCarDto,
  })
  @sentOnly()
  @IsObject()
  @ValidateNested()
  @Type(() => CourtesyCarDto)
  courtesyCar?: CourtesyCarDto;

  @ApiProperty({
    description: 'All three; at least one true',
    type: PaymentMethodsDto,
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PaymentMethodsDto)
  @atLeastOnePayment()
  paymentMethods!: PaymentMethodsDto;
}

// All optional but the stamp; which groups were sent, and whether any was,
// is the use case's to judge.
export class UpdateGarageProfileDto {
  @ApiProperty({
    description: "The profile's change stamp as last read",
    maxLength: 20,
    minLength: 1,
  })
  @IsString()
  @Length(1, 20)
  version!: string;

  @ApiPropertyOptional({
    description: 'Trimmed before it is counted and stored',
    maxLength: NAME_MAX,
    minLength: NAME_MIN,
  })
  @sentOnly()
  @holds('nameWithin', textWithin(NAME_MIN, NAME_MAX))
  name?: string;

  @ApiPropertyOptional({
    description: 'Trimmed; empty clears it',
    maxLength: PROFILE_DESCRIPTION_MAX,
  })
  @sentOnly()
  @holds('descriptionWithin', textWithin(0, PROFILE_DESCRIPTION_MAX))
  description?: string;

  @ApiPropertyOptional({
    description: 'As typed; a Romanian number, stored as +40 and nine digits',
  })
  @sentOnly()
  @holds('phoneNumber', (value) => {
    const phone = typeof value === 'string' ? normalisePhone(value) : null;
    return phone !== null && isRomanianPhone(phone);
  })
  phone?: string;

  @ApiPropertyOptional({
    additionalProperties: {
      items: {
        items: { type: 'string' },
        maxItems: 2,
        minItems: 2,
        type: 'array',
      },
      type: 'array',
    },
    description:
      'Each weekday (mon…sun) to its intervals as "HH:MM" pairs, an empty list on a closed day; sent with closedDays',
    type: 'object',
  })
  @sentOnly()
  @holds('weeklyHours', isWeeklyHours)
  hours?: WeeklyHours;

  @ApiPropertyOptional({
    description: `Every closed day the garage keeps, once each; a note up to ${CLOSED_NOTE_MAX} characters`,
    items: {
      properties: {
        day: { format: 'date', type: 'string' },
        note: { maxLength: CLOSED_NOTE_MAX, type: 'string' },
      },
      required: ['day'],
      type: 'object',
    },
    type: 'array',
  })
  @sentOnly()
  @holds('closedDays', (value) => closedDaysError(value) === null)
  closedDays?: ClosedDay[];

  @ApiPropertyOptional({
    description: 'A mobile mechanic only',
    maximum: PROFILE_RADIUS_KM.max,
    minimum: PROFILE_RADIUS_KM.min,
    type: 'integer',
  })
  @sentOnly()
  @IsInt()
  @Min(PROFILE_RADIUS_KM.min)
  @Max(PROFILE_RADIUS_KM.max)
  serviceRadiusKm?: number;

  @ApiPropertyOptional({
    description:
      'The facilities, their note, the courtesy car terms and the payment methods, sent whole',
    type: FacilitiesGroupDto,
  })
  @sentOnly()
  @IsObject()
  @ValidateNested()
  @Type(() => FacilitiesGroupDto)
  facilities?: FacilitiesGroupDto;
}
