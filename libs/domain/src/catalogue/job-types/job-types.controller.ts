import { JobTypeListDto, JobTypesQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { JobTypesService } from './job-types.service';
import { Public } from '../../auth/actor.guard';

@ApiTags('catalogue')
@Controller('job-types')
export class JobTypesController {
  constructor(private readonly jobTypes: JobTypesService) {}

  @Get()
  @Public()
  @ApiOkResponse({ type: JobTypeListDto })
  search(@Query() query: JobTypesQueryDto): Promise<JobTypeListDto> {
    return this.jobTypes.search(query.q);
  }
}
