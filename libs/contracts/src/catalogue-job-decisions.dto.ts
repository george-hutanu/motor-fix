import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsString,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';

import { CAR_SYSTEMS, type CarSystem } from './car-systems';
import { RarActivityNameDto } from './legal-check.dto';
import {
  JOB_NAME_MAX,
  PROPOSED_JOB_NAME_MIN,
  REJECTION_REASON_MAX,
  REJECTION_REASON_MIN,
} from './price-range';
import {
  CATALOGUE_JOB_NAME,
  REJECTION_REASON,
  type VisibleTextRule,
  visibleTextProblem,
} from './visible-text';

const RAR_ACTIVITY_MAX = 120;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// The shared rule the dialogs judge with too: no control characters, and a
// length of what shows.
const VisibleText = (rule: VisibleTextRule) =>
  ValidateBy({
    name: 'visibleText',
    validator: {
      defaultMessage: (args) =>
        `${args?.property} must hold ${rule.min} to ${rule.max} visible characters and no control characters`,
      validate: (value) =>
        typeof value === 'string' && visibleTextProblem(value, rule) === null,
    },
  });

export class AdminCatalogueJobGarageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Atelier Dinamo' })
  name!: string;

  @ApiProperty({ example: 'atelier-dinamo' })
  slug!: string;
}

// A job a garage proposed, waiting for an admin: the text as typed, the
// garage (absent when it is gone) and its default range (absent when gone).
export class AdminCatalogueJobDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Recondiționare injectoare' })
  name!: string;

  @ApiProperty({ format: 'date-time' })
  proposedAt!: string;

  @ApiPropertyOptional({ type: AdminCatalogueJobGarageDto })
  garage?: AdminCatalogueJobGarageDto;

  @ApiPropertyOptional({ example: 18_000 })
  fromBani?: number;

  @ApiPropertyOptional({ example: 42_000 })
  toBani?: number;

  @ApiPropertyOptional({ example: 90 })
  durationMinutes?: number;
}

export class AdminCatalogueJobsDto {
  @ApiProperty({ isArray: true, type: AdminCatalogueJobDto })
  items!: AdminCatalogueJobDto[];

  @ApiProperty({ isArray: true, type: RarActivityNameDto })
  rarActivities!: RarActivityNameDto[];
}

export class ApproveCatalogueJobDto {
  @ApiProperty({
    example: 'Recondiționare injectoare',
    maxLength: JOB_NAME_MAX,
    minLength: PROPOSED_JOB_NAME_MIN,
  })
  @Transform(trimmed)
  @IsString()
  @VisibleText(CATALOGUE_JOB_NAME)
  nameRo!: string;

  @ApiProperty({
    example: 'Injector reconditioning',
    maxLength: JOB_NAME_MAX,
    minLength: PROPOSED_JOB_NAME_MIN,
  })
  @Transform(trimmed)
  @IsString()
  @VisibleText(CATALOGUE_JOB_NAME)
  nameEn!: string;

  @ApiProperty({ enum: CAR_SYSTEMS, example: 'engine' })
  @IsIn(CAR_SYSTEMS)
  carSystem!: CarSystem;

  @ApiPropertyOptional({
    description: 'A code of the RAR activity list; absent when none is needed',
    example: 'mechanics',
    maxLength: RAR_ACTIVITY_MAX,
  })
  // Absent is the only way to say none: a null is refused.
  @ValidateIf((body: ApproveCatalogueJobDto) => body.rarActivity !== undefined)
  @IsString()
  @MaxLength(RAR_ACTIVITY_MAX)
  rarActivity?: string;
}

export class RejectCatalogueJobDto {
  @ApiProperty({
    example: 'Este o reparație generică, nu o lucrare de catalog.',
    maxLength: REJECTION_REASON_MAX,
    minLength: REJECTION_REASON_MIN,
  })
  @Transform(trimmed)
  @IsString()
  @VisibleText(REJECTION_REASON)
  reason!: string;
}

// The decided job as the admin's call answers it.
export class CatalogueJobDecisionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['approved', 'rejected'] })
  status!: 'approved' | 'rejected';

  @ApiProperty({ example: 'Recondiționare injectoare' })
  nameRo!: string;

  @ApiProperty({ example: 'Injector reconditioning' })
  nameEn!: string;

  @ApiPropertyOptional({ enum: CAR_SYSTEMS })
  carSystem?: CarSystem;

  @ApiPropertyOptional({ example: 'mechanics', nullable: true, type: String })
  rarActivity?: string | null;

  @ApiPropertyOptional()
  rejectionReason?: string;

  @ApiProperty({ format: 'date-time' })
  decidedAt!: string;
}
