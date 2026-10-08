import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsLatLong, IsOptional, Matches, ValidateBy } from 'class-validator';

import { inRomania } from './place-section';

export class NearQueryDto {
  @ApiPropertyOptional({
    description:
      'The place the count is measured from, as "lat,lng" in Romania; rounded to three decimals. Without it, all of Romania',
    example: '46.771,23.624',
  })
  @IsOptional()
  // IsLatLong alone takes a third number after the second comma.
  @Matches(/^[^,]+,[^,]+$/)
  @IsLatLong()
  @ValidateBy({
    name: 'nearInRomania',
    validator: {
      defaultMessage: () => 'near must be a place in Romania',
      validate: (value: unknown) => {
        if (typeof value !== 'string') return false;
        const [lat, lng] = value.split(',').map(Number);
        return inRomania(lat, lng);
      },
    },
  })
  near?: string;
}
