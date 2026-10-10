import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

export const ROLE = [
  'driver',
  'garage',
  'receptionist',
  'mechanic',
  'admin',
] as const;
type Role = (typeof ROLE)[number];

const LANGUAGE = ['ro', 'en'] as const;

const NO_CONTROL = /^\P{Cc}*$/u;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Each field is optional; one left out is not changed.
export class UpdateMeDto {
  @ApiPropertyOptional({ enum: LANGUAGE })
  @ValidateIf((body) => body.language !== undefined)
  @IsIn(LANGUAGE)
  language?: (typeof LANGUAGE)[number];

  @ApiPropertyOptional({ description: 'Trimmed', maxLength: 80, minLength: 2 })
  @ValidateIf((body) => body.name !== undefined)
  @Transform(trimmed)
  @IsString()
  @Length(2, 80)
  @Matches(NO_CONTROL, { message: 'name must not hold control characters' })
  name?: string;

  @ApiPropertyOptional({
    description: 'Trimmed; null or blank saves no city',
    maxLength: 60,
    minLength: 2,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsString()
  @Length(2, 60)
  @Matches(NO_CONTROL, { message: 'city must not hold control characters' })
  city?: string | null;
}

const GARAGE_STATUS = ['draft', 'approved', 'suspended'] as const;
const GARAGE_ROLE = ['owner', 'receptionist', 'mechanic'] as const;

export class GaragePermissionsDto {
  @ApiProperty()
  canMoveBookings!: boolean;

  @ApiProperty()
  canAnswerQuotes!: boolean;

  @ApiProperty()
  canRecordFinalPrice!: boolean;
}

// What the person may do at one garage they work at.
export class GarageAccessDto {
  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: GARAGE_STATUS })
  status!: (typeof GARAGE_STATUS)[number];

  @ApiProperty({ description: 'The role at this garage', enum: GARAGE_ROLE })
  role!: (typeof GARAGE_ROLE)[number];

  @ApiProperty({ type: GaragePermissionsDto })
  permissions!: GaragePermissionsDto;

  @ApiProperty({
    additionalProperties: { type: 'boolean' },
    description: 'The garage’s feature switches by key; a missing key is on',
    type: 'object',
  })
  features!: Record<string, boolean>;
}

export class MeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({
    description: 'Whether the e-mail is confirmed; false when there is none',
  })
  emailConfirmed!: boolean;

  @ApiProperty({ enum: LANGUAGE })
  language!: (typeof LANGUAGE)[number];

  @ApiProperty({
    description: 'The city saved in Setări',
    nullable: true,
    type: String,
  })
  city!: string | null;

  @ApiProperty({ description: 'E.164', nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({
    description: 'Whether the phone is confirmed; false when there is none',
  })
  phoneConfirmed!: boolean;

  @ApiProperty({
    description: 'The address of an e-mail change waiting for its link',
    nullable: true,
    type: String,
  })
  pendingEmail!: string | null;

  @ApiProperty({ description: 'Whether the account can sign in by password' })
  hasPassword!: boolean;

  @ApiProperty({ enum: ROLE, isArray: true })
  roles!: Role[];

  @ApiProperty({ description: 'The role in use', enum: ROLE })
  role!: Role;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  garageId!: string | null;

  @ApiProperty({
    description: 'The garages the account works at; empty with none',
    isArray: true,
    type: GarageAccessDto,
  })
  garageAccess!: GarageAccessDto[];

  @ApiProperty({
    description: 'What the role in use may do',
    isArray: true,
    type: String,
  })
  capabilities!: string[];

  @ApiProperty({ enum: ['/app/driver', '/app/garage', '/app/admin'] })
  landing!: '/app/driver' | '/app/garage' | '/app/admin';
}
