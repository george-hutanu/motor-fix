import {
  AdminBrandDto,
  AdminBrandListDto,
  AdminBrandsQueryDto,
  CreateBrandDto,
  UpdateBrandDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';

import { BrandsService } from './brands.service';
import { CurrentActor, Requires } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

// The brand list as an admin keeps it: no route deletes a brand, retiring is
// the only way out of the pickers.
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/brands')
export class AdminBrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @Requires('admin.catalogue')
  @ApiOkResponse({ type: AdminBrandListDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  list(
    @CurrentActor() actor: Actor,
    @Query() query: AdminBrandsQueryDto,
  ): Promise<AdminBrandListDto> {
    return this.brands.list(actor, query.q);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JsonOnly)
  @Requires('admin.catalogue')
  @ApiCreatedResponse({ type: AdminBrandDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  @ApiConflictResponse({ description: 'brand_exists' })
  @ApiUnsupportedMediaTypeResponse({ description: 'unsupported_media_type' })
  create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateBrandDto,
  ): Promise<AdminBrandDto> {
    return this.brands.create(actor, body);
  }

  @Patch(':id')
  @HttpCode(200)
  @UseGuards(JsonOnly)
  @Requires('admin.catalogue')
  @ApiOkResponse({ type: AdminBrandDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no brand' })
  @ApiConflictResponse({
    description: 'stale_value (with the current brand); brand_exists',
  })
  @ApiUnsupportedMediaTypeResponse({ description: 'unsupported_media_type' })
  update(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateBrandDto,
  ): Promise<AdminBrandDto> {
    return this.brands.update(actor, id, body);
  }
}
