import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { GarageBrandAnswerDto } from './garage-brands.dto';

// A garage as anyone may read it: only an approved one is ever returned.
export class PublicGarageDto extends GarageBrandAnswerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiPropertyOptional({ description: 'A workshop only.', maxLength: 200 })
  address?: string;

  @ApiPropertyOptional({ description: 'A workshop only.', format: 'double' })
  latitude?: number;

  @ApiPropertyOptional({ description: 'A workshop only.', format: 'double' })
  longitude?: number;

  @ApiPropertyOptional({
    description: 'A mobile mechanic only: how far from its base it travels.',
    maximum: 100,
    minimum: 1,
  })
  serviceRadiusKm?: number;
}
