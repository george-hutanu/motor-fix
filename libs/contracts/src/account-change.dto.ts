import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

import { PhoneCodeDto } from './auth.dto';
import { EMAIL_PATTERN } from './email';

// The bodies of the account's own contact and password changes (Setări).

export class EmailChangeDto {
  @ApiProperty({
    description: 'The new address; trimmed and lower-cased',
    maxLength: 254,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(254)
  @Matches(EMAIL_PATTERN, { message: 'email must look like an address' })
  email!: string;
}

// The address a change link went to, shown until its link is opened.
export class PendingEmailDto {
  @ApiProperty()
  pendingEmail!: string;
}

export class PhoneChangeDto extends PickType(PhoneCodeDto, [
  'phone',
] as const) {}

export class PhoneConfirmDto {
  @ApiProperty({
    description: 'The six digits sent by WhatsApp',
    pattern: '^\\d{6}$',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code!: string;
}

// The length and common-password rules are the service's (weak_password),
// as at sign-up.
export class PasswordChangeDto {
  @ApiPropertyOptional({
    description: 'Required when the account already has a password',
    maxLength: 1024,
  })
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  currentPassword?: string;

  @ApiProperty({
    description: '8 to 128 characters, not a common password',
    maxLength: 1024,
  })
  @IsString()
  @Length(1, 1024)
  newPassword!: string;
}
