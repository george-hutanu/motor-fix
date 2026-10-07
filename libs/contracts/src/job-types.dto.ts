import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class JobTypesQueryDto {
  @ApiPropertyOptional({
    description: 'Part of a job name; accents and case are ignored',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class JobTypeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'front-brakes' })
  key!: string;

  @ApiProperty({ example: 'Plăcuțe frână față' })
  nameRo!: string;

  @ApiProperty({ example: 'Front brake pads' })
  nameEn!: string;
}

export class JobTypeListDto {
  @ApiProperty({
    description: 'Approved jobs by Romanian name; 20 at most',
    type: [JobTypeDto],
  })
  items!: JobTypeDto[];
}
