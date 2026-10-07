import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export class JobTypesQueryDto {
  @ApiPropertyOptional({
    description: 'Part of a job name; accents and case are ignored',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({
    description:
      'Comma-separated job keys; answers those jobs only, past the first 20',
    example: 'diagnosis,oil-service',
  })
  @IsOptional()
  @Matches(/^[a-z0-9-]{1,80}(,[a-z0-9-]{1,80}){0,49}$/)
  keys?: string;

  @ApiPropertyOptional({
    description:
      'Comma-separated job ids, 50 at most; answers those jobs only, past the first 20',
  })
  @IsOptional()
  @Matches(new RegExp(`^${UUID}(,${UUID}){0,49}$`, 'i'))
  ids?: string;
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
    description:
      'Approved jobs by Romanian name; 20 at most for a search, every one named by keys or ids',
    type: [JobTypeDto],
  })
  items!: JobTypeDto[];
}
