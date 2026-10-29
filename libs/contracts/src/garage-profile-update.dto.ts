import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Allow,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateBy,
} from 'class-validator';

import {
  CLOSED_NOTE_MAX,
  type ClosedDay,
  closedDaysError,
  isWeeklyHours,
  type WeeklyHours,
} from './garage-hours';
import { NAME_MAX, NAME_MIN, trimmedWithin } from './listing-sections';
import { normalisePhone } from './phone';

export const PROFILE_DESCRIPTION_MAX = 1000;
export const PROFILE_RADIUS_KM = { max: 100, min: 5 } as const;

const holds = (name: string, check: (value: unknown) => boolean) =>
  ValidateBy({
    name,
    validator: {
      defaultMessage: (args) => `${args?.property} is not valid`,
      validate: check,
    },
  });

const textWithin = (min: number, max: number) => (value: unknown) =>
  typeof value === 'string' && trimmedWithin(value, min, max);

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
  @IsOptional()
  @holds('nameWithin', textWithin(NAME_MIN, NAME_MAX))
  name?: string;

  @ApiPropertyOptional({
    description: 'Trimmed; empty clears it',
    maxLength: PROFILE_DESCRIPTION_MAX,
  })
  @IsOptional()
  @holds('descriptionWithin', textWithin(0, PROFILE_DESCRIPTION_MAX))
  description?: string;

  @ApiPropertyOptional({
    description: 'As typed; stored as the E.164 number it reads as',
  })
  @IsOptional()
  @holds(
    'phoneNumber',
    (value) => typeof value === 'string' && normalisePhone(value) !== null,
  )
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
  @IsOptional()
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
  @IsOptional()
  @holds('closedDays', (value) => closedDaysError(value) === null)
  closedDays?: ClosedDay[];

  @ApiPropertyOptional({
    description: 'A mobile mechanic only',
    maximum: PROFILE_RADIUS_KM.max,
    minimum: PROFILE_RADIUS_KM.min,
    type: 'integer',
  })
  @IsOptional()
  @IsInt()
  @Min(PROFILE_RADIUS_KM.min)
  @Max(PROFILE_RADIUS_KM.max)
  serviceRadiusKm?: number;

  // Admitted only to be answered 422 needs_verification by name.
  @ApiPropertyOptional({ description: 'Refused: needs verification' })
  @Allow()
  address?: unknown;

  @ApiPropertyOptional({ description: 'Refused: needs verification' })
  @Allow()
  companyName?: unknown;

  @ApiPropertyOptional({ description: 'Refused: needs verification' })
  @Allow()
  cui?: unknown;

  @ApiPropertyOptional({ description: 'Refused: needs verification' })
  @Allow()
  mobileLegalForm?: unknown;

  @ApiPropertyOptional({ description: 'Refused: needs verification' })
  @Allow()
  seatAddress?: unknown;

  @ApiPropertyOptional({ description: 'Refused: needs verification' })
  @Allow()
  rarActivities?: unknown;

  @ApiPropertyOptional({ description: 'Refused: needs verification' })
  @Allow()
  proposedJobs?: unknown;
}
