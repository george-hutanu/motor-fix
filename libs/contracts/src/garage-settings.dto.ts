import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsObject,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  COURTESY_PRICE_MAX_BANI,
  COURTESY_PRICE_MIN_BANI,
  COURTESY_PRICE_STEP_BANI,
  isCourtesyPrice,
} from './garage-hours';

export class PaymentMethodsDto {
  @ApiProperty()
  @IsBoolean()
  cash!: boolean;

  @ApiProperty()
  @IsBoolean()
  card!: boolean;

  @ApiProperty()
  @IsBoolean()
  transfer!: boolean;
}

// A price exactly when paid: the database holds the same rule.
const pricedWhenPaid = () =>
  ValidateBy({
    name: 'pricedWhenPaid',
    validator: {
      defaultMessage: () =>
        'pricePerDayBani must be whole lei from 1 to 2,000 when paid, and absent when free',
      validate: (value, args) =>
        (args?.object as CourtesyCarDto | undefined)?.paid === true
          ? isCourtesyPrice(value)
          : value === undefined,
    },
  });

export class CourtesyCarDto {
  @ApiProperty()
  @IsBoolean()
  paid!: boolean;

  @ApiPropertyOptional({
    description: 'Per day, in bani: whole lei; only when paid',
    maximum: COURTESY_PRICE_MAX_BANI,
    minimum: COURTESY_PRICE_MIN_BANI,
    multipleOf: COURTESY_PRICE_STEP_BANI,
    type: 'integer',
  })
  @pricedWhenPaid()
  pricePerDayBani?: number;
}

const atLeastOnePayment = () =>
  ValidateBy({
    name: 'atLeastOnePayment',
    validator: {
      defaultMessage: () => 'paymentMethods must take at least one',
      validate: (value: PaymentMethodsDto | undefined) =>
        value?.cash === true ||
        value?.card === true ||
        value?.transfer === true,
    },
  });

// Either key or both; an empty body changes nothing and is refused.
export class UpdateGarageDto {
  @ApiPropertyOptional({
    description: 'All three; at least one true',
    type: PaymentMethodsDto,
  })
  @ValidateIf(
    (o: UpdateGarageDto) =>
      o.courtesyCar === undefined || o.paymentMethods !== undefined,
  )
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PaymentMethodsDto)
  @atLeastOnePayment()
  paymentMethods?: PaymentMethodsDto;

  @ApiPropertyOptional({
    description: 'Only for a garage that lists the courtesy car',
    type: CourtesyCarDto,
  })
  @ValidateIf((o: UpdateGarageDto) => o.courtesyCar !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => CourtesyCarDto)
  courtesyCar?: CourtesyCarDto;
}

// What is stored after the write.
export class GarageSettingsDto {
  @ApiProperty({ type: PaymentMethodsDto })
  paymentMethods!: PaymentMethodsDto;

  @ApiPropertyOptional({
    description: 'Absent when the garage does not list the courtesy car',
    type: CourtesyCarDto,
  })
  courtesyCar?: CourtesyCarDto;
}
