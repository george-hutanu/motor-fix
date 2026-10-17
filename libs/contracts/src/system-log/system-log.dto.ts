import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import {
  SYSTEM_LOG_KINDS,
  SYSTEM_LOG_PAGE,
  SYSTEM_LOG_PAGE_MAX,
  SYSTEM_LOG_SEARCH_MAX,
  SYSTEM_LOG_SEARCH_MIN,
  SYSTEM_LOG_SEVERITIES,
  SYSTEM_LOG_SOURCES,
  type SystemLogKind,
  type SystemLogSeverity,
  type SystemLogSource,
} from './system-log';
import { toQueryNumber } from '../verification-queue';

// An instant, never a calendar day: the panel turns Bucharest's midnight into one.
const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const ZONED = { message: '$property must be a date-time with a zone' };

// A parameter given once arrives as a string, repeated as a list.
const many = ({ value }: { value: unknown }) =>
  value === undefined || Array.isArray(value) ? value : [value];
const trimmed = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  return value.trim() || undefined;
};

export class SystemLogQueryDto {
  @ApiProperty({
    description: 'Entries at or after this instant',
    format: 'date-time',
  })
  @Matches(INSTANT, ZONED)
  @IsISO8601({ strict: true })
  from!: string;

  @ApiPropertyOptional({
    description: 'Entries before this instant; after `from`',
    format: 'date-time',
  })
  @IsOptional()
  @Matches(INSTANT, ZONED)
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ enum: SYSTEM_LOG_KINDS, isArray: true })
  @IsOptional()
  @Transform(many)
  @IsIn(SYSTEM_LOG_KINDS, { each: true })
  kind?: SystemLogKind[];

  @ApiPropertyOptional({ enum: SYSTEM_LOG_SEVERITIES, isArray: true })
  @IsOptional()
  @Transform(many)
  @IsIn(SYSTEM_LOG_SEVERITIES, { each: true })
  severity?: SystemLogSeverity[];

  @ApiPropertyOptional({ enum: SYSTEM_LOG_SOURCES, isArray: true })
  @IsOptional()
  @Transform(many)
  @IsIn(SYSTEM_LOG_SOURCES, { each: true })
  source?: SystemLogSource[];

  @ApiPropertyOptional({
    description:
      'Text in the message, ignoring case and diacritics; trimmed, empty is absent',
    maxLength: SYSTEM_LOG_SEARCH_MAX,
    minLength: SYSTEM_LOG_SEARCH_MIN,
  })
  @IsOptional()
  @Transform(trimmed)
  @Length(SYSTEM_LOG_SEARCH_MIN, SYSTEM_LOG_SEARCH_MAX)
  q?: string;

  @ApiPropertyOptional({
    description: "A previous answer's nextCursor, sent with the same filters",
    maxLength: 200,
  })
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{1,200}$/)
  cursor?: string;

  @ApiPropertyOptional({
    default: SYSTEM_LOG_PAGE,
    maximum: SYSTEM_LOG_PAGE_MAX,
    minimum: 1,
    type: 'integer',
  })
  @IsOptional()
  @Transform(toQueryNumber)
  @IsInt()
  @Min(1)
  @Max(SYSTEM_LOG_PAGE_MAX)
  limit?: number;
}

export class SystemLogEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  at!: string;

  @ApiProperty({ enum: SYSTEM_LOG_SOURCES })
  source!: SystemLogSource;

  @ApiProperty({ enum: SYSTEM_LOG_SEVERITIES })
  severity!: SystemLogSeverity;

  @ApiProperty({ enum: SYSTEM_LOG_KINDS })
  kind!: SystemLogKind;

  @ApiProperty({ description: 'The stored English text' })
  message!: string;

  @ApiProperty({
    additionalProperties: true,
    description: "The kind's ids, codes and figures; never free text",
    type: 'object',
  })
  context!: Record<string, unknown>;

  @ApiProperty({
    description: 'How many times it happened in its minute',
    minimum: 1,
    type: 'integer',
  })
  count!: number;
}

export class SystemLogDto {
  @ApiProperty({ type: [SystemLogEntryDto] })
  items!: SystemLogEntryDto[];

  @ApiProperty({
    description: 'The next page, or null when there is none',
    nullable: true,
    type: String,
  })
  nextCursor!: string | null;
}
