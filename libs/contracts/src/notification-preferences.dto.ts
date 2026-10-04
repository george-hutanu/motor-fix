import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const GROUPS = [
  'offers',
  'bookings',
  'due_dates',
  'news',
  'reviews_history',
] as const;
const CHANNELS = ['email', 'push', 'sms', 'whatsapp'] as const;

export type NotificationGroupKey = (typeof GROUPS)[number];
export type PreferenceChannel = (typeof CHANNELS)[number];

export class UpdateNotificationGroupDto {
  @ApiProperty({ enum: GROUPS })
  @IsIn(GROUPS)
  key!: NotificationGroupKey;

  @ApiProperty({ description: 'The switch: on or off' })
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

  @ApiProperty({ enum: CHANNELS })
  @IsIn(CHANNELS)
  channel!: PreferenceChannel;

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

export class NotificationPreferencesDto {
  @ApiProperty({ isArray: true, type: NotificationGroupDto })
  groups!: NotificationGroupDto[];

  @ApiProperty({ isArray: true, type: NotificationPreferenceDto })
  preferences!: NotificationPreferenceDto[];
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
}
