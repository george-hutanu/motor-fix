import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class TestMessageDto {
  @ApiProperty({
    description: 'The accounts that get the test e-mail',
    format: 'uuid',
    isArray: true,
    maxItems: 20,
    minItems: 1,
    type: String,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  accountIds!: string[];
}

export class TestMessageQueuedDto {
  @ApiProperty({ description: 'How many test e-mails were queued' })
  queued!: number;
}

const BELL_LANGUAGES = ['ro', 'en'] as const;

export class NotificationListQueryDto {
  @ApiPropertyOptional({
    description: 'The last item of the previous page',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({
    description: "The texts' language; the account's when left out",
    enum: BELL_LANGUAGES,
  })
  @IsOptional()
  @IsIn(BELL_LANGUAGES)
  language?: (typeof BELL_LANGUAGES)[number];
}

export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'A catalogue type, e.g. QUOTE_RECEIVED' })
  kind!: string;

  @ApiProperty({
    description: 'The object it is about',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  subjectId!: string | null;

  @ApiProperty({ description: 'Rendered in the language asked' })
  text!: string;

  @ApiProperty({
    description:
      'The driver view the row opens, e.g. /app/driver/cars/<id>; null when it opens nothing',
    example: '/app/driver/cars/6f1c2a3e-1d4b-4a8e-9c1f-2b3d4e5f6a7b',
    nullable: true,
    type: String,
  })
  link!: string | null;

  @ApiProperty({ format: 'date-time' })
  at!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  readAt!: string | null;
}

export class NotificationPageDto {
  @ApiProperty({ type: [NotificationDto] })
  items!: NotificationDto[];

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  nextCursor!: string | null;
}

export class UnreadCountDto {
  @ApiProperty({ description: 'Unread bell notifications of the last 90 days' })
  count!: number;
}
