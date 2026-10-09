import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveAssistantSignInDto {
  @ApiProperty({
    description: 'The signed hand-off from the connect page address',
    maxLength: 4096,
  })
  @IsString()
  @MaxLength(4096)
  request!: string;
}

export class AssistantApprovalDto {
  @ApiProperty({
    description: "The identity server's address, with the code and the state",
  })
  redirect!: string;
}

// The identity server's token request (client_secret_post). Every field is
// optional here so a missing one answers the OAuth error, not a field error.
export class AssistantTokenDto {
  @ApiPropertyOptional({ example: 'authorization_code', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  grant_type?: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  code?: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  redirect_uri?: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  client_id?: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  client_secret?: string;

  @ApiPropertyOptional({
    description: 'Sent when the identity server uses PKCE; not checked',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  code_verifier?: string;
}

export class AssistantTokensDto {
  @ApiProperty({ description: 'HS256, signed with the client secret' })
  id_token!: string;

  @ApiProperty({ description: 'The same token as id_token' })
  access_token!: string;

  @ApiProperty({ enum: ['Bearer'] })
  token_type!: 'Bearer';

  @ApiProperty({ example: 300 })
  expires_in!: number;
}
