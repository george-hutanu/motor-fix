import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

export class SaveGarageDto {
  @ApiPropertyOptional({
    description:
      'An undo: the time the garage was first saved, never in the future',
    format: 'date-time',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  savedAt?: string;
}

export class SavedGarageDto {
  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty({ description: 'UTC', format: 'date-time' })
  savedAt!: string;
}

export class SavedGarageIdsDto {
  @ApiProperty({
    description: 'In no promised order',
    format: 'uuid',
    type: [String],
  })
  ids!: string[];
}
