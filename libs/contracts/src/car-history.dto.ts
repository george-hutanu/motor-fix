import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CarRepairCarDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  brandName!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty({ type: 'integer' })
  year!: number;
}

export class RepairReviewDto {
  @ApiProperty({
    description:
      'write: the driver may still review; rated: a review stands; none: neither',
    enum: ['write', 'rated', 'none'],
  })
  state!: 'write' | 'rated' | 'none';

  @ApiPropertyOptional({
    description: 'Only with rated',
    maximum: 5,
    minimum: 1,
    type: 'integer',
  })
  rating?: number;
}

export class CarRepairDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date' })
  doneOn!: string;

  @ApiProperty({ description: 'What was done' })
  what!: string;

  @ApiProperty()
  garageName!: string;

  @ApiProperty({
    description: 'The garage on MotorFix',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  garageId!: string | null;

  @ApiProperty({ type: CarRepairCarDto })
  car!: CarRepairCarDto;

  @ApiProperty({
    description: "A MotorFix repair's mechanic, as the job names them",
    nullable: true,
    type: String,
  })
  mechanicName!: string | null;

  @ApiProperty({
    description:
      'Null on every row until the review drawer ships and fills it for a MotorFix repair',
    nullable: true,
    type: RepairReviewDto,
  })
  review!: RepairReviewDto | null;

  @ApiProperty({ enum: ['motorfix', 'logged'] })
  source!: 'motorfix' | 'logged';

  @ApiProperty({
    description: 'Created before the reader held the car: it came with it',
  })
  fromPreviousOwner!: boolean;

  @ApiProperty({ nullable: true, type: 'integer' })
  odometerKm!: number | null;

  @ApiProperty({ description: 'In bani', nullable: true, type: 'integer' })
  costBani!: number | null;

  @ApiProperty({
    description:
      'Who last corrected it: the garage it names or an admin; none for the driver',
    enum: ['garage', 'admin'],
    nullable: true,
    type: String,
  })
  correctedBy!: 'garage' | 'admin' | null;
}

export class CarRepairListDto {
  @ApiProperty({ description: 'Newest first', type: [CarRepairDto] })
  items!: CarRepairDto[];
}

export class RepairsQueryDto {
  @ApiPropertyOptional({ description: 'The nextCursor of the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({
    default: 20,
    description: 'Repairs per page',
    maximum: 20,
    minimum: 1,
    type: 'integer',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @ApiPropertyOptional({
    description: 'One of the caller’s cars',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  carId?: string;
}

export class RepairListDto {
  @ApiProperty({
    description: 'Newest first, across the caller’s cars',
    type: [CarRepairDto],
  })
  items!: CarRepairDto[];

  @ApiProperty({
    description: 'Pass as cursor for the next page; null on the last',
    nullable: true,
    type: String,
  })
  nextCursor!: string | null;
}

export class SoldCarDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  brandName!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ format: 'date' })
  saleDate!: string;
}

export class SoldCarListDto {
  @ApiProperty({ description: 'Newest sale first', type: [SoldCarDto] })
  items!: SoldCarDto[];
}
