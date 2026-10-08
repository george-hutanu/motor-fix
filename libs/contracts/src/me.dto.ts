import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const ROLE = [
  'driver',
  'garage',
  'receptionist',
  'mechanic',
  'admin',
] as const;
type Role = (typeof ROLE)[number];

const LANGUAGE = ['ro', 'en'] as const;

export class UpdateMeDto {
  @ApiProperty({ enum: LANGUAGE })
  @IsIn(LANGUAGE)
  language!: (typeof LANGUAGE)[number];
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
