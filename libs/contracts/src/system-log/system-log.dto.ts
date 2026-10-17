import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

import {
  SYSTEM_LOG_KINDS,
  SYSTEM_LOG_PAGE,
  SYSTEM_LOG_SEVERITIES,
  SYSTEM_LOG_SOURCES,
  type SystemLogKind,
  type SystemLogSource,
} from './system-log';
import { toQueryNumber } from '../verification-queue';

// An instant, never a calendar day: the panel turns Bucharest's midnight into one.
const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export class SystemLogQueryDto {
  @ApiProperty({
    description: 'Entries at or after this instant',
    format: 'date-time',
  })
  @Matches(INSTANT, { message: '$property must be a date-time with a zone' })
  @IsISO8601({ strict: true })
  from!: string;

  @ApiPropertyOptional({
    default: SYSTEM_LOG_PAGE,
    maximum: SYSTEM_LOG_PAGE,
    minimum: 1,
    type: 'integer',
  })
  @IsOptional()
  @Transform(toQueryNumber)
  @IsInt()
  @Min(1)
  @Max(SYSTEM_LOG_PAGE)
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
  severity!: (typeof SYSTEM_LOG_SEVERITIES)[number];

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
}
