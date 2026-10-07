import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class PublicHolidaysQueryDto {
  @ApiProperty({ example: 2026, maximum: 2100, minimum: 2000, type: 'integer' })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}

export class PublicHolidayDto {
  @ApiProperty({ example: '2026-12-01', format: 'date' })
  day!: string;

  @ApiProperty({ example: 'Ziua Națională' })
  nameRo!: string;

  @ApiProperty({ example: 'National Day' })
  nameEn!: string;
}
