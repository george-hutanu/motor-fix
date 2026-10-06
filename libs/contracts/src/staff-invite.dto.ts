import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

const STAFF_INVITE_KINDS = ['mechanic', 'receptionist'] as const;
export type StaffInviteKind = (typeof STAFF_INVITE_KINDS)[number];

// Left out takes the default; null is not a permission.
const given = (_: object, value: unknown) => value !== undefined;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// An owner's invitation to a person, by e-mail. The permissions apply to a
// mechanic only; a receptionist's are stored off.
export class StaffInviteDto {
  @ApiProperty({ description: 'Trimmed', maxLength: 80, minLength: 2 })
  @Transform(trimmed)
  @IsString()
  @Length(2, 80)
  @Matches(/^\P{Cc}*$/u, { message: 'name must not hold control characters' })
  name!: string;

  @ApiProperty({
    description: 'Trimmed; stored and compared in lower case',
    maxLength: 254,
  })
  @Transform(trimmed)
  @IsString()
  @Length(3, 254)
  @Matches(/^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u, {
    message: 'email must look like an address',
  })
  email!: string;

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

  @ApiProperty({ description: 'The invited address' })
  email!: string;
}
