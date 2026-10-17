import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  SUSPENSION_CAUSES,
  type SuspensionCause,
} from './garage-suspension.dto';
import { VerificationQueueAreaDto } from './verification-queue';
import {
  VERIFICATION_QUEUE_MAX,
  VERIFICATION_QUEUE_PAGE,
} from './verification-target';

export const RAR_VERDICTS = ['expired', 'suspended', 'withdrawn'] as const;
export type RarVerdict = (typeof RAR_VERDICTS)[number];

export class AdminGaragesSummaryDto {
  @ApiProperty({ description: 'Garages approved', minimum: 0, type: 'integer' })
  listed!: number;

  @ApiProperty({
    description: 'Verification files submitted or in review',
    minimum: 0,
    type: 'integer',
  })
  waiting!: number;

  @ApiProperty({
    description: 'Garages suspended',
    minimum: 0,
    type: 'integer',
  })
  suspended!: number;
}

export class AdminGaragesQueryDto {
  @ApiProperty({ enum: ['suspended'] })
  @IsIn(['suspended'])
  status!: 'suspended';

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

export class SuspendedGarageRowDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({
    description: "The garage's newest verification file; absent when none",
    format: 'uuid',
  })
  fileId?: string;

  @ApiPropertyOptional({
    description: 'Absent when the garage has no town recorded',
    type: VerificationQueueAreaDto,
  })
  area?: VerificationQueueAreaDto;

  @ApiPropertyOptional({
    description: 'The open suspension; absent when the garage has none',
    enum: SUSPENSION_CAUSES,
  })
  cause?: SuspensionCause;

  @ApiPropertyOptional({ description: 'The reason as stored' })
  reason?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  fromTime?: string;

  @ApiPropertyOptional({
    description: 'Bookings cancelled by the suspension since it began',
    minimum: 0,
    type: 'integer',
  })
  cancelledBookings?: number;

  @ApiPropertyOptional({
    description: 'Only for a failed re-check that names the verdict',
    enum: RAR_VERDICTS,
  })
  rarVerdict?: RarVerdict;
}

export class AdminGaragesDto {
  @ApiProperty({ type: [SuspendedGarageRowDto] })
  items!: SuspendedGarageRowDto[];

  @ApiProperty({ minimum: 0, type: 'integer' })
  total!: number;
}
