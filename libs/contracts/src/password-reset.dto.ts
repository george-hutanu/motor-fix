import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class PasswordResetDto {
  @ApiProperty({
    description: 'Trimmed; compared without letter case',
    maxLength: 254,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 254)
  @Matches(/^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u, {
    message: 'email must look like an address',
  })
  email!: string;
}

export class PasswordResetCheckDto {
  @ApiProperty({
    description: "The token of a reset link: the link's last part",
    maxLength: 256,
  })
  @IsString()
  @Length(1, 256)
  token!: string;
}

export class PasswordResetCompleteDto extends PasswordResetCheckDto {
  @ApiProperty({
    description: '8 to 128 characters, not a common password',
    maxLength: 1024,
    minLength: 1,
  })
  @IsString()
  @Length(1, 1024)
  password!: string;
}
