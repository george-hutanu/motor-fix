import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

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

  @ApiProperty()
  onProfile!: boolean;

  @ApiProperty()
  hasAccount!: boolean;

  // One decimal ("4.9"); null exactly when no review counts.
  @ApiProperty({ example: '4.9', nullable: true, type: String })
  rating!: string | null;

  @ApiProperty()
  reviewCount!: number;
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
}

// The fields of a card the owner writes. The limits are judged by the
// service, which answers 422 with every problem at once; `@Allow` only lets
// each field through the global whitelist. The photo, the bio and the
// languages are the mechanic's and are refused with 403 mechanic_owned_field.
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
}
