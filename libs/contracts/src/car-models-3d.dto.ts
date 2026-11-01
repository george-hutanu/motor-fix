import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

import { FUELS, type Fuel } from './marked-brands';

const BODY_STYLES = [
  'saloon',
  'hatchback',
  'suv',
  'crossover',
  'estate',
  'fastback',
] as const;
export type BodyStyle = (typeof BODY_STYLES)[number];

const CAR_MODEL_3D_SOURCES = ['own_car', 'brand', 'generic'] as const;
type CarModel3dSource = (typeof CAR_MODEL_3D_SOURCES)[number];

export class CarModels3dQueryDto {
  @ApiProperty({
    description: 'The brand, by its catalogue key',
    example: 'dacia',
    pattern: '^[a-z0-9-]{1,40}$',
  })
  @IsString()
  @Matches(/^[a-z0-9-]{1,40}$/)
  brand!: string;

  @ApiPropertyOptional({
    description:
      "One of the signed-in driver's own cars of the brand; the answer is about that car alone",
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  car?: string;
}

class CarModel3dBrandDto {
  @ApiProperty({ example: 'dacia' })
  key!: string;

  @ApiProperty({ example: 'Dacia' })
  name!: string;
}

export class CarModel3dSystemDto {
  @ApiProperty({ example: 'engine' })
  code!: string;

  @ApiProperty({ example: 'Motor' })
  nameRo!: string;

  @ApiProperty({ example: 'Engine' })
  nameEn!: string;

  @ApiProperty({
    description:
      'The approved catalogue jobs on this system, by Romanian name; empty when none',
    format: 'uuid',
    type: [String],
  })
  jobTypeIds!: string[];
}

export class CarModel3dDto {
  @ApiProperty({ type: CarModel3dBrandDto })
  brand!: CarModel3dBrandDto;

  @ApiProperty({
    description:
      "own_car: a model the driver owns; brand: the brand's most popular licensed model; generic: the brand's body shape",
    enum: CAR_MODEL_3D_SOURCES,
  })
  source!: CarModel3dSource;

  @ApiProperty({
    description: 'The licensed model; null for a generic shape',
    example: 'Logan',
    nullable: true,
    type: String,
  })
  model!: string | null;

  @ApiProperty({
    description:
      "The file's fuel, whose parts it holds; petrol for a generic shape",
    enum: FUELS,
  })
  fuel!: Fuel;

  @ApiProperty({ enum: BODY_STYLES })
  bodyStyle!: BodyStyle;

  @ApiProperty({
    description: 'The GLB, an absolute URL or a path from the site root',
    example: '/api/v1/car-models-3d/files/dacia-logan.2099f2575d8f1377.glb',
  })
  fileUrl!: string;

  @ApiProperty({
    description: "The systems of the file's fuel, in position order",
    type: [CarModel3dSystemDto],
  })
  systems!: CarModel3dSystemDto[];
}
