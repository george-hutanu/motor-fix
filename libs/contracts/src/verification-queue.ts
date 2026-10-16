import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { CheckSummaryDto, type Lamp } from './verification-checks';
import {
  VERIFICATION_QUEUE_MAX,
  VERIFICATION_QUEUE_PAGE,
} from './verification-target';

export class VerificationQueueQueryDto {
  @ApiPropertyOptional({
    default: 0,
    maximum: 10_000,
    minimum: 0,
    type: 'integer',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset?: number;

  @ApiPropertyOptional({
    default: VERIFICATION_QUEUE_PAGE,
    description: 'A live re-read asks for every row already shown',
    maximum: VERIFICATION_QUEUE_MAX,
    minimum: 1,
    type: 'integer',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(VERIFICATION_QUEUE_MAX)
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
