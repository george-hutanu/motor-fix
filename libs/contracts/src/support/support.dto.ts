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

import {
  SUPPORT_EMAIL_MAX,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_MIN,
  SUPPORT_NAME_MAX,
  SUPPORT_SUBJECT_REF_MAX,
  SUPPORT_TOPICS,
  type SupportTopic,
} from './support';
import { EMAIL_PATTERN } from '../email';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSupportMessageDto {
  @ApiProperty({ description: 'Trimmed', maxLength: SUPPORT_NAME_MAX })
  @Transform(trimmed)
  @IsString()
  @Length(1, SUPPORT_NAME_MAX)
  name!: string;

  @ApiProperty({ description: 'Trimmed', maxLength: SUPPORT_EMAIL_MAX })
  @Transform(trimmed)
  @IsString()
  @MaxLength(SUPPORT_EMAIL_MAX)
  @Matches(EMAIL_PATTERN, { message: 'email must look like an address' })
  email!: string;

  @ApiProperty({ enum: SUPPORT_TOPICS })
  @IsIn(SUPPORT_TOPICS)
  topic!: SupportTopic;

  @ApiProperty({
    description: 'Trimmed',
    maxLength: SUPPORT_MESSAGE_MAX,
    minLength: SUPPORT_MESSAGE_MIN,
  })
  @Transform(trimmed)
  @IsString()
  @Length(SUPPORT_MESSAGE_MIN, SUPPORT_MESSAGE_MAX)
  message!: string;

  @ApiProperty({ enum: ['ro', 'en'] })
  @IsIn(['ro', 'en'])
  language!: 'ro' | 'en';

  @ApiPropertyOptional({
    description: 'A request’s or a booking’s id',
    maxLength: SUPPORT_SUBJECT_REF_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPORT_SUBJECT_REF_MAX)
  subjectRef?: string;

  @ApiPropertyOptional({ description: 'Leave empty' })
  @IsOptional()
  @IsString()
  website?: string;
}

export class SupportMessageCreatedDto {
  @ApiProperty({ example: 'MF-2026-000042' })
  reference!: string;
}

export class SupportContactDto {
  @ApiProperty({ nullable: true, type: String })
  email!: string | null;
}
