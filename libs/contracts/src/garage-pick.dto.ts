import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';

// The garage picker's question: part of an approved garage's name.
export class GaragePickQueryDto {
  @ApiProperty({ description: 'Trimmed', maxLength: 80, minLength: 2 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 80)
  q!: string;

  @ApiPropertyOptional({
    default: 8,
    maximum: 8,
    minimum: 1,
    type: 'integer',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  limit = 8;
}

export class GaragePickDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  city!: string | null;
}

export class GaragePickListDto {
  @ApiProperty({ description: 'By name', type: [GaragePickDto] })
  items!: GaragePickDto[];
}
