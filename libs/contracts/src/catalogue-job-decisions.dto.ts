import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

import { CAR_SYSTEMS, type CarSystem } from './car-systems';
import { RarActivityNameDto } from './legal-check.dto';
import {
  JOB_NAME_MAX,
  PROPOSED_JOB_NAME_MIN,
  REJECTION_REASON_MAX,
  REJECTION_REASON_MIN,
} from './price-range';

const RAR_ACTIVITY_MAX = 120;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

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
  @Length(PROPOSED_JOB_NAME_MIN, JOB_NAME_MAX)
  @Matches(/^\P{Cc}*$/u, { message: 'nameRo must not hold control characters' })
  nameRo!: string;

  @ApiProperty({
    example: 'Injector reconditioning',
    maxLength: JOB_NAME_MAX,
    minLength: PROPOSED_JOB_NAME_MIN,
  })
  @Transform(trimmed)
  @IsString()
  @Length(PROPOSED_JOB_NAME_MIN, JOB_NAME_MAX)
  @Matches(/^\P{Cc}*$/u, { message: 'nameEn must not hold control characters' })
  nameEn!: string;

  @ApiProperty({ enum: CAR_SYSTEMS, example: 'engine' })
  @IsIn(CAR_SYSTEMS)
  carSystem!: CarSystem;

  @ApiPropertyOptional({
    description: 'A code of the RAR activity list; absent when none is needed',
    example: 'mechanics',
    maxLength: RAR_ACTIVITY_MAX,
  })
  @IsOptional()
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
  @Length(REJECTION_REASON_MIN, REJECTION_REASON_MAX)
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
