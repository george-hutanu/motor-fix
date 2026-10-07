import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { PRIVACY_VERSION, TERMS_VERSION } from './consent';
import { EMAIL_PATTERN } from './email';
import { ROLE } from './me.dto';
import { E164, normalisePhone } from './phone';

export { EMAIL_PATTERN } from './email';

export class SignInDto {
  @ApiProperty({
    description: 'Trimmed; compared without letter case',
    maxLength: 254,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 254)
  @Matches(/^\P{Cc}*$/u, { message: 'email must not hold control characters' })
  email!: string;

  @ApiProperty({ maxLength: 1024, minLength: 1 })
  @IsString()
  @Length(1, 1024)
  password!: string;

  @ApiPropertyOptional({
    default: true,
    description: 'Keep the session after the browser closes',
  })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// The versions of the terms of use and the privacy notice the person ticked.
// Any version but the current one is refused as consent_required.
export class ConsentDto {
  @ApiProperty({ example: TERMS_VERSION, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  termsVersion?: string;

  @ApiProperty({ example: PRIVACY_VERSION, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  privacyVersion?: string;
}

export class SignUpDto {
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
  @Matches(EMAIL_PATTERN, {
    message: 'email must look like an address',
  })
  email!: string;

  @ApiProperty({
    description: '8 to 128 characters, not a common password',
    maxLength: 1024,
    minLength: 1,
  })
  @IsString()
  @Length(1, 1024)
  password!: string;

  @ApiProperty({ description: 'The interface language', enum: ['ro', 'en'] })
  @IsIn(['ro', 'en'])
  language!: 'ro' | 'en';

  @ApiPropertyOptional({
    description:
      'The current terms and privacy versions; without them the answer is 400 consent_required',
    type: ConsentDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentDto)
  consent?: ConsentDto;
}

export class SessionDto {
  @ApiProperty({
    description: 'Bearer token, valid 15 minutes; keep it in memory',
  })
  accessToken!: string;
}

// A number as typed becomes E.164; one that cannot be read stays as it came
// and fails the pattern.
const phone = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.length <= 32
    ? (normalisePhone(value) ?? value)
    : value;

const PHONE = {
  description:
    'As typed: spaces, dots, dashes and brackets dropped, 00 and a national 0 read as +40; must then be E.164',
  example: '0722 123 456',
  maxLength: 32,
  minLength: 1,
} as const;

export class PhoneCodeDto {
  @ApiProperty(PHONE)
  @Transform(phone)
  @IsString()
  @Matches(E164, { message: 'phone must be a possible phone number' })
  phone!: string;

  @ApiPropertyOptional({
    default: 'ro',
    description: 'The language of the WhatsApp message',
    enum: ['ro', 'en'],
  })
  @IsOptional()
  @IsIn(['ro', 'en'])
  language?: 'ro' | 'en';
}

// Name and consent come together, to create an account for a new number.
const creating = (body: { name?: unknown; consent?: unknown }) =>
  body.name !== undefined || body.consent !== undefined;

export class PhoneSignInDto {
  @ApiProperty(PHONE)
  @Transform(phone)
  @IsString()
  @Matches(E164, { message: 'phone must be a possible phone number' })
  phone!: string;

  @ApiProperty({
    description: 'The six digits sent by WhatsApp',
    pattern: '^\\d{6}$',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code!: string;

  @ApiPropertyOptional({
    default: true,
    description: 'Keep the session after the browser closes',
  })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;

  @ApiPropertyOptional({
    description: 'Trimmed; with consent, creates an account for a new number',
    maxLength: 80,
    minLength: 2,
  })
  @ValidateIf(creating)
  @Transform(trimmed)
  @IsString()
  @Length(2, 80)
  @Matches(/^\P{Cc}*$/u, { message: 'name must not hold control characters' })
  name?: string;

  @ApiPropertyOptional({
    description:
      'The current terms and privacy versions; required with the name',
    type: ConsentDto,
  })
  @ValidateIf(creating)
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentDto)
  consent?: ConsentDto;

  @ApiPropertyOptional({
    default: 'ro',
    description: "A new account's language",
    enum: ['ro', 'en'],
  })
  @IsOptional()
  @IsIn(['ro', 'en'])
  language?: 'ro' | 'en';
}

// A session, or, for a right code to a number no account holds, the
// profile step that creates one.
export class PhoneSessionDto {
  @ApiPropertyOptional({
    description: 'Bearer token, valid 15 minutes; keep it in memory',
  })
  accessToken?: string;

  @ApiPropertyOptional({
    description: 'No account holds the number: send the name and consent',
    enum: ['profile'],
  })
  next?: 'profile';
}

export class ConfirmEmailDto {
  @ApiProperty({
    description: 'The token of a confirmation link: 43 base64url characters',
    pattern: '^[A-Za-z0-9_-]{43}$',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'token must be a link token' })
  token!: string;
}

export class ConfirmEmailAnswerDto {
  @ApiProperty({ enum: ['confirmed'] })
  status!: 'confirmed';
}

export class SwitchRoleDto {
  @ApiProperty({
    description: 'One of the roles the account holds',
    enum: ROLE,
  })
  @IsIn(ROLE)
  role!: (typeof ROLE)[number];
}

export class RefreshDto {
  @ApiPropertyOptional({
    description:
      'The role the tab is showing; used when the account still holds it',
    enum: ROLE,
  })
  @IsOptional()
  @IsIn(ROLE)
  role?: (typeof ROLE)[number];
}

export const OAUTH_PROVIDER = ['google', 'apple'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDER)[number];

export class ProvidersDto {
  @ApiProperty({ description: 'Sign-in with Apple is configured' })
  apple!: boolean;

  @ApiProperty({ description: 'Sign-in with Google is configured' })
  google!: boolean;
}

// What a provider gave for a person who has no account yet.
export class OAuthPendingDto {
  @ApiProperty({ enum: OAUTH_PROVIDER })
  provider!: OAuthProvider;

  @ApiProperty({ description: 'The name the provider gave; may be empty' })
  name!: string;

  @ApiPropertyOptional({ description: 'The e-mail the provider gave' })
  email?: string;
}

export class OAuthCompleteDto {
  @ApiProperty({ description: 'Trimmed', maxLength: 80, minLength: 2 })
  @Transform(trimmed)
  @IsString()
  @Length(2, 80)
  @Matches(/^\P{Cc}*$/u, { message: 'name must not hold control characters' })
  name!: string;

  @ApiProperty({ description: 'The interface language', enum: ['ro', 'en'] })
  @IsIn(['ro', 'en'])
  language!: 'ro' | 'en';

  @ApiPropertyOptional({
    description:
      'The current terms and privacy versions; without them the answer is 400 consent_required',
    type: ConsentDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentDto)
  consent?: ConsentDto;
}
