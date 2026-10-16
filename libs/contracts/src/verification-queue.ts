import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  CheckSummaryDto,
  type Lamp,
  type VerificationCheckResult,
} from './verification-checks';

// The target shown to garages is 1 to 2 working days: a file that has
// waited longer is flagged in the admins' queue.
export const VERIFICATION_TARGET_WORKING_DAYS = 2;
export const VERIFICATION_QUEUE_PAGE = 20;
export const VERIFICATION_QUEUE_PANEL = 5;

// A row's one lamp: a failed check first, then the flag or a warning, then
// any check passed.
export function queueLamp(
  checks: readonly { result: VerificationCheckResult }[],
  flagged: boolean,
): Lamp {
  const has = (result: VerificationCheckResult) =>
    checks.some((check) => check.result === result);
  if (has('failed')) return 'red';
  if (flagged || has('warning')) return 'amber';
  return has('ok') ? 'green' : 'grey';
}

export class VerificationQueueQueryDto {
  @ApiPropertyOptional({ default: 0, maximum: 10_000, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset?: number;

  @ApiPropertyOptional({
    default: VERIFICATION_QUEUE_PAGE,
    description: 'A live re-read asks for every row already shown',
    maximum: 200,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class VerificationQueueAreaDto {
  @ApiProperty({ enum: ['town', 'mobile'] })
  kind!: 'town' | 'mobile';

  @ApiPropertyOptional({ description: 'The town; only for a town' })
  name?: string;

  @ApiPropertyOptional({
    description: 'The service radius; only for a mobile mechanic',
    type: 'integer',
  })
  radiusKm?: number;
}

export class VerificationQueueRowDto {
  @ApiProperty({ description: 'The verification file', format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['submitted', 'in_review'] })
  status!: 'submitted' | 'in_review';

  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty()
  garageName!: string;

  @ApiPropertyOptional({
    description: 'Absent when the garage has no town recorded',
    type: VerificationQueueAreaDto,
  })
  area?: VerificationQueueAreaDto;

  @ApiProperty({
    description: 'Brands the garage works on',
    minimum: 0,
    type: 'integer',
  })
  brands!: number;

  @ApiPropertyOptional({
    description: "The garage's mechanics; absent when it keeps no team",
    minimum: 0,
    type: 'integer',
  })
  mechanics?: number;

  @ApiProperty({ type: CheckSummaryDto })
  summary!: CheckSummaryDto;

  @ApiProperty({
    description: 'Red on a failed check, amber when flagged or on a warning',
    enum: ['green', 'amber', 'red', 'grey'],
  })
  lamp!: Lamp;

  @ApiProperty({ description: 'The latest sending', format: 'date-time' })
  submittedAt!: Date;

  @ApiProperty({
    description: 'Working days waited, in Europe/Bucharest',
    minimum: 0,
    type: 'integer',
  })
  workingDays!: number;

  @ApiProperty({ description: 'Waited more than the 2 working days' })
  flagged!: boolean;
}

export class VerificationQueueDto {
  @ApiProperty({
    description: 'Oldest sending first',
    type: [VerificationQueueRowDto],
  })
  items!: VerificationQueueRowDto[];

  @ApiProperty({
    description: 'Every file waiting, as the overview counts them',
    minimum: 0,
    type: 'integer',
  })
  total!: number;
}
