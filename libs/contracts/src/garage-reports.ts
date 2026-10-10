import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

import {
  GARAGE_REPORT_TEXT_MAX,
  GARAGE_REPORT_TEXT_MIN,
} from './garage-report-text';

export { GARAGE_REPORT_TEXT_MAX, GARAGE_REPORT_TEXT_MIN };

export class CreateGarageReportDto {
  @ApiProperty({
    description: 'What happened, stored as written (never trimmed)',
    maxLength: GARAGE_REPORT_TEXT_MAX,
    minLength: GARAGE_REPORT_TEXT_MIN,
  })
  @IsString()
  @Length(GARAGE_REPORT_TEXT_MIN, GARAGE_REPORT_TEXT_MAX)
  text!: string;
}

export class GarageReportCreatedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
