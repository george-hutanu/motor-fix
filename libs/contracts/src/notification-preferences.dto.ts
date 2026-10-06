import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// The driver's switches, and the channels a message goes by outside the app.
export const NOTIFICATION_GROUPS = [
  'offers',
  'bookings',
  'due_dates',
  'news',
  'reviews_history',
] as const;
export const OUTSIDE_CHANNELS = ['email', 'push', 'sms', 'whatsapp'] as const;

export type NotificationGroupKey = (typeof NOTIFICATION_GROUPS)[number];
export type OutsideChannel = (typeof OUTSIDE_CHANNELS)[number];

export class UpdateNotificationGroupDto {
  @ApiProperty({ enum: NOTIFICATION_GROUPS })
  @IsIn(NOTIFICATION_GROUPS)
  key!: NotificationGroupKey;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class NotificationGroupDto extends UpdateNotificationGroupDto {
  @ApiProperty({
    description: 'The notification types the switch covers',
    isArray: true,
    type: String,
  })
  types!: string[];
}

export class UpdateNotificationPreferenceDto {
  @ApiProperty({ description: 'A notification type, e.g. QUOTE_RECEIVED' })
  @IsString()
  @MaxLength(64)
  type!: string;

  @ApiProperty({ enum: OUTSIDE_CHANNELS })
  @IsIn(OUTSIDE_CHANNELS)
  channel!: OutsideChannel;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    description: 'The garage of a staff choice; null for a personal one',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  garageId!: string | null;
}

export class NotificationPreferenceDto extends UpdateNotificationPreferenceDto {
  @ApiProperty({ description: 'Sent whatever the person chooses' })
  alwaysSent!: boolean;
}

// The consent text the driver confirms before news is turned on (draft,
// pending the lawyer's review): a new text is a new version.
export const NEWS_CONSENT_TEXT_VERSION = '2026-10-03';
const NEWS_CONSENT_STATES = ['none', 'given', 'withdrawn'] as const;

export class NewsConsentDto {
  @ApiProperty({ enum: NEWS_CONSENT_STATES })
  state!: (typeof NEWS_CONSENT_STATES)[number];

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  givenAt!: string | null;

  @ApiProperty({
    description: 'The consent text version the driver confirmed',
    nullable: true,
    type: String,
  })
  textVersion!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  withdrawnAt!: string | null;

  @ApiProperty({ description: 'The version to show, and send back on saving' })
  currentTextVersion!: string;
}

// What a garage's staff or an admin choose for the messages of their work.
export const STAFF_CHANNELS = ['email', 'push', 'whatsapp'] as const;
export const STAFF_ROLES = [
  'owner',
  'receptionist',
  'mechanic',
  'admin',
] as const;
export const STAFF_SECTIONS = [
  'requests_quotes',
  'bookings',
  'reviews',
  'account',
  'admin',
] as const;
export const WHATSAPP_UNAVAILABLE = [
  'garage_whatsapp_off',
  'phone_not_verified',
] as const;

export type StaffChannel = (typeof STAFF_CHANNELS)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];
export type StaffSectionKey = (typeof STAFF_SECTIONS)[number];

export class StaffChannelDto {
  @ApiProperty({ enum: STAFF_CHANNELS })
  channel!: StaffChannel;

  @ApiProperty({ description: 'Whether the message goes by this channel' })
  enabled!: boolean;

  @ApiProperty({ description: 'Always on: it cannot be switched off' })
  locked!: boolean;
}

export class StaffNotificationTypeDto {
  @ApiProperty({ description: 'A notification type, e.g. REQUEST_RECEIVED' })
  type!: string;

  @ApiProperty({
    description: 'Empty for a type that is shown in the app only',
    isArray: true,
    type: StaffChannelDto,
  })
  channels!: StaffChannelDto[];
}

export class StaffSectionDto {
  @ApiProperty({ enum: STAFF_SECTIONS })
  key!: StaffSectionKey;

  @ApiProperty({ isArray: true, type: StaffNotificationTypeDto })
  types!: StaffNotificationTypeDto[];
}

export class StaffWhatsAppDto {
  @ApiProperty()
  available!: boolean;

  @ApiProperty({ enum: WHATSAPP_UNAVAILABLE, nullable: true, type: String })
  reason!: (typeof WHATSAPP_UNAVAILABLE)[number] | null;
}

export class StaffNotificationsDto {
  @ApiProperty({
    description: 'Null for the admin list',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  garageId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  garageName!: string | null;

  @ApiProperty({ enum: STAFF_ROLES })
  role!: StaffRole;

  @ApiProperty({ type: StaffWhatsAppDto })
  whatsapp!: StaffWhatsAppDto;

  @ApiProperty({ isArray: true, type: StaffSectionDto })
  sections!: StaffSectionDto[];
}

export class NotificationPreferencesDto {
  @ApiProperty({ isArray: true, type: NotificationGroupDto })
  groups!: NotificationGroupDto[];

  @ApiProperty({ isArray: true, type: NotificationPreferenceDto })
  preferences!: NotificationPreferenceDto[];

  @ApiProperty({ type: NewsConsentDto })
  newsConsent!: NewsConsentDto;

  @ApiProperty({
    description:
      'One list per garage the person is staff of, and one for an admin',
    isArray: true,
    type: StaffNotificationsDto,
  })
  staff!: StaffNotificationsDto[];
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({
    isArray: true,
    maxItems: 5,
    required: false,
    type: UpdateNotificationGroupDto,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => UpdateNotificationGroupDto)
  groups?: UpdateNotificationGroupDto[];

  @ApiProperty({
    isArray: true,
    maxItems: 200,
    required: false,
    type: UpdateNotificationPreferenceDto,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => UpdateNotificationPreferenceDto)
  preferences?: UpdateNotificationPreferenceDto[];

  @ApiProperty({
    description:
      'The consent text version shown, needed when the save turns news on',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  newsConsentTextVersion?: string;
}

class NewsTextDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  ro!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  en!: string;
}

// A title is the e-mail's subject line.
class NewsTitleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  ro!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  en!: string;
}

export class SendNewsDto {
  @ApiProperty({ description: 'The subject, in both languages' })
  @IsObject()
  @ValidateNested()
  @Type(() => NewsTitleDto)
  title!: NewsTitleDto;

  @ApiProperty({ description: 'The text, in both languages' })
  @IsObject()
  @ValidateNested()
  @Type(() => NewsTextDto)
  text!: NewsTextDto;
}

export class NewsSentDto {
  @ApiProperty({ description: 'How many drivers it was sent to' })
  recipients!: number;
}
