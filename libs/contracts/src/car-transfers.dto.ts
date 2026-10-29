import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

// How long a transfer link stays valid.
export const CAR_TRANSFER_LINK_VALID_DAYS = 7;

export class CarSaleRepairDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date' })
  doneOn!: string;

  @ApiProperty({ description: 'What was done' })
  what!: string;

  @ApiProperty()
  garageName!: string;

  @ApiProperty({
    description:
      'motorfix: done through MotorFix, always passed on; logged: added by the owner, passed on when ticked',
    enum: ['motorfix', 'logged'],
  })
  source!: 'motorfix' | 'logged';
}

export class CarTransferLineDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class CarSaleTransferDto extends CarTransferLineDto {
  @ApiProperty({ description: 'E.164', example: '+40722123456' })
  buyerPhone!: string;
}

export class CarSaleDto {
  @ApiProperty({ description: 'False while the car has a request under way' })
  canStart!: boolean;

  @ApiProperty({ enum: ['open_request'], nullable: true, type: String })
  reason!: 'open_request' | null;

  @ApiProperty({
    description: 'Active repairs, newest first',
    type: [CarSaleRepairDto],
  })
  repairs!: CarSaleRepairDto[];

  @ApiProperty({
    description: 'The sent transfer while within its time; never the link',
    nullable: true,
    type: CarSaleTransferDto,
  })
  transfer!: CarSaleTransferDto | null;
}

export class CreateCarTransferDto {
  @ApiProperty({
    description: "The buyer's phone, as typed",
    example: '0722 123 456',
    maxLength: 32,
    minLength: 1,
  })
  @IsString()
  @Length(1, 32)
  buyerPhone!: string;

  @ApiProperty({
    description: "The ticked repairs: the car's own active logged repairs",
    format: 'uuid',
    maxItems: 200,
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  repairIds!: string[];
}

export class CarTransferSentDto {
  @ApiProperty({ type: CarTransferLineDto })
  transfer!: CarTransferLineDto;

  @ApiProperty({
    description: 'The link for the buyer; answered here only, never again',
  })
  link!: string;

  @ApiProperty({
    description: 'Whether the WhatsApp message to the buyer left',
    enum: ['sent', 'failed'],
  })
  whatsapp!: 'sent' | 'failed';
}

export class CarTransferOfferCarDto {
  @ApiProperty({ description: "The brand's name" })
  brand!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;
}

export class CarTransferLinkDto {
  @ApiProperty({ enum: ['sent'] })
  status!: 'sent';

  @ApiProperty({
    description: 'Signed in only: the car on offer, never its plate',
    required: false,
    type: CarTransferOfferCarDto,
  })
  car?: CarTransferOfferCarDto;

  @ApiProperty({
    description: 'Signed in only: how many repairs pass with the car',
    required: false,
  })
  repairCount?: number;

  @ApiProperty({
    description:
      "Signed in only: the seller's first name and the initial of the last, or null",
    nullable: true,
    required: false,
    type: String,
  })
  sellerName?: string | null;
}

export class CarTransferAcceptedDto {
  @ApiProperty({ description: "The car, now the caller's", format: 'uuid' })
  carId!: string;
}
