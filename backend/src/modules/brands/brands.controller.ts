import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { AccessService } from '../../shared/access/access.service'
import { AuthGuard } from '../../shared/auth.guard'
import { CreateBrandDto } from './dto/create-brand.dto'
import { UpdateBrandDto } from './dto/update-brand.dto'
import { BrandsService } from './brands.service'

@Controller('brands')
@UseGuards(AuthGuard)
export class BrandsController {
  constructor(
    private readonly brandsService: BrandsService,
    private readonly access: AccessService
  ) {}

  @Get('project/:projectId')
  async findByProject(@Param('projectId') projectId: string, @Req() req: any) {
    await this.access.assertProjectAccess(req.user.userId, projectId, 'VIEWER')
    const brands = await this.brandsService.findByProject(projectId)
    return { brands }
  }

  @Post('project/:projectId')
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateBrandDto,
    @Req() req: any
  ) {
    await this.access.assertProjectAccess(req.user.userId, projectId, 'ADMIN')
    const brand = await this.brandsService.create(projectId, dto)
    return { brand }
  }

  @Patch(':brandId')
  async update(
    @Param('brandId') brandId: string,
    @Body() dto: UpdateBrandDto,
    @Req() req: any
  ) {
    await this.access.assertBrandAccess(req.user.userId, brandId, 'ADMIN')
    const brand = await this.brandsService.update(brandId, dto)
    return { brand }
  }

  @Delete(':brandId')
  async delete(@Param('brandId') brandId: string, @Req() req: any) {
    await this.access.assertBrandAccess(req.user.userId, brandId, 'ADMIN')
    await this.brandsService.delete(brandId)
    return { success: true }
  }
}
