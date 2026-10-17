import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, Matches } from 'class-validator';

export const SUSPENSION_CAUSES = [
  'recheck_failed',
  'documents_overdue',
  'admin',
  'report_confirmed',
] as const;
export type SuspensionCause = (typeof SUSPENSION_CAUSES)[number];

const SUSPENSION_REASON_MAX = 200;

const NO_CONTROL = /^\P{Cc}*$/u;

export class SuspendGarageDto {
  @ApiProperty({ enum: SUSPENSION_CAUSES })
  @IsIn(SUSPENSION_CAUSES)
  cause!: SuspensionCause;

  @ApiProperty({
    description: 'Trimmed; shown to the garage as written',
    maxLength: SUSPENSION_REASON_MAX,
    minLength: 1,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, SUSPENSION_REASON_MAX)
  @Matches(NO_CONTROL, { message: 'reason must not hold control characters' })
  reason!: string;
}

export class GarageSuspensionCreatedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty({ enum: SUSPENSION_CAUSES })
  cause!: SuspensionCause;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ format: 'date-time' })
  fromTime!: string;
}
