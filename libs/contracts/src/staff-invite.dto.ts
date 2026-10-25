import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';

import { E164, normalisePhone } from './phone';

const STAFF_INVITE_KINDS = ['mechanic', 'receptionist'] as const;
export type StaffInviteKind = (typeof STAFF_INVITE_KINDS)[number];

// Left out takes the default; null is not a permission.
const given = (_: object, value: unknown) => value !== undefined;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// A number as typed becomes E.164; one that cannot be read stays as it came
// and fails the pattern.
const phone = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.length <= 32
    ? (normalisePhone(value) ?? value)
    : value;

const forMechanic = (field: string) =>
  ValidateBy({
    name: 'forMechanic',
    validator: {
      defaultMessage: () => `${field} is for a mechanic only`,
      validate: (_, args) =>
        (args?.object as StaffInviteDto | undefined)?.kind === 'mechanic',
    },
  });

// An owner's invitation to a person, by e-mail or, for a mechanic, by phone,
// optionally for one of the garage's cards. The permissions apply to a
// mechanic only; a receptionist's are stored off.
export class StaffInviteDto {
  @ApiPropertyOptional({
    description:
      'The card the invite is for; accepting links the account to it',
    format: 'uuid',
  })
  @ValidateIf(given)
  @IsUUID()
  @forMechanic('mechanicId')
  mechanicId?: string;

  @ApiPropertyOptional({
    description: 'Trimmed; required without mechanicId, ignored with it',
    maxLength: 80,
    minLength: 2,
  })
  @ValidateIf(
    (dto: StaffInviteDto) =>
      dto.mechanicId === undefined || dto.name !== undefined,
  )
  @Transform(trimmed)
  @IsString()
  @Length(2, 80)
  @Matches(/^\P{Cc}*$/u, { message: 'name must not hold control characters' })
  name?: string;

  @ApiPropertyOptional({
    description:
      'Trimmed; stored and compared in lower case. Exactly one of email and phone',
    maxLength: 254,
  })
  @ValidateIf((dto: StaffInviteDto) => dto.phone === undefined)
  @Transform(trimmed)
  @IsString()
  @Length(3, 254)
  @Matches(/^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u, {
    message: 'email must look like an address',
  })
  email?: string;

  @ApiPropertyOptional({
    description:
      'For a mechanic; as typed, read as in the phone sign-in, must then be E.164. Exactly one of email and phone',
    example: '0722 123 456',
    maxLength: 20,
  })
  @ValidateIf(
    (dto: StaffInviteDto) => dto.phone !== undefined || dto.email === undefined,
  )
  @Transform(phone)
  @IsString()
  @MaxLength(20)
  @Matches(E164, { message: 'phone must be a possible phone number' })
  @forMechanic('phone')
  @ValidateBy({
    name: 'oneAddress',
    validator: {
      defaultMessage: () => 'give an e-mail or a phone, not both',
      validate: (_, args) =>
        (args?.object as StaffInviteDto | undefined)?.email === undefined,
    },
  })
  phone?: string;

  @ApiProperty({ enum: STAFF_INVITE_KINDS })
  @IsIn(STAFF_INVITE_KINDS)
  kind!: StaffInviteKind;

  @ApiPropertyOptional({ default: false })
  @ValidateIf(given)
  @IsBoolean()
  canMoveBookings = false;

  @ApiPropertyOptional({ default: false })
  @ValidateIf(given)
  @IsBoolean()
  canAnswerQuotes = false;

  @ApiPropertyOptional({ default: false })
  @ValidateIf(given)
  @IsBoolean()
  canRecordFinalPrice = false;
}

export class StaffInviteSentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'False when the e-mail could not be sent' })
  emailSent!: boolean;

  @ApiPropertyOptional({
    description:
      'The invite link, only when the e-mail could not be sent, for the owner to pass on',
  })
  link?: string;
}

export class InviteTokenDto {
  @ApiProperty({ description: "The invite link's token", maxLength: 256 })
  @IsString()
  @Length(1, 256)
  token!: string;
}

export class InviteViewDto {
  @ApiProperty({ description: 'The garage name, as typed by its owner' })
  garage!: string;

  @ApiProperty({ enum: STAFF_INVITE_KINDS })
  kind!: StaffInviteKind;

  @ApiProperty({ description: "The invitee's name, as the owner typed it" })
  name!: string;

  @ApiProperty({
    description: 'The invited e-mail',
    nullable: true,
    type: String,
  })
  email!: string | null;

  @ApiProperty({
    description: 'The invited phone, E.164',
    nullable: true,
    type: String,
  })
  phone!: string | null;

  @ApiProperty({
    description:
      'The garage the signed-in account works at, which accepting leaves; null signed out or when it works nowhere else',
    nullable: true,
    type: String,
  })
  leaving!: string | null;
}

// The card's open invite in the team list, expired or not.
export class StaffInviteOnCardDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({ format: 'date-time' })
  sentAt!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}
