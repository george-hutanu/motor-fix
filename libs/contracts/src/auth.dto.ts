import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class SignInDto {
  @ApiProperty({
    description: 'Trimmed; compared without letter case',
    maxLength: 254,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 254)
  @Matches(/^\P{Cc}*$/u, { message: 'email must not hold control characters' })
  email!: string;

  @ApiProperty({ maxLength: 1024, minLength: 1 })
  @IsString()
  @Length(1, 1024)
  password!: string;

  @ApiPropertyOptional({
    default: true,
    description: 'Keep the session after the browser closes',
  })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class SessionDto {
  @ApiProperty({
    description: 'Bearer token, valid 15 minutes; keep it in memory',
  })
  accessToken!: string;
}
