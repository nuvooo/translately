import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma.service'
import { ChangeEventsService } from '../change-events/change-events.service'

@Injectable()
export class BrandsService {
  private readonly logger = new Logger(BrandsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ChangeEventsService
  ) {}

  async findByProject(projectId: string) {
    return this.prisma.brand.findMany({
      where: { projectId },
    })
  }

  async create(
    projectId: string,
    data: { name: string; key: string; description?: string }
  ) {
    const brand = await this.prisma.brand.create({
      data: {
        name: data.name,
        key: data.key,
        description: data.description,
        projectId,
      },
    })
    await this.recordBrandChanged(projectId)
    return brand
  }

  async update(brandId: string, data: { name?: string; description?: string }) {
    // Copy only whitelisted fields (never projectId/key from the request).
    const updateData: { name?: string; description?: string } = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.description !== undefined) {
      updateData.description = data.description
    }
    const brand = await this.prisma.brand.update({
      where: { id: brandId },
      data: updateData,
    })
    await this.recordBrandChanged(brand.projectId)
    return brand
  }

  /** Deletes the brand together with its own texts (`scope = brandId`). */
  async delete(brandId: string) {
    const existing = await this.prisma.brand.findUnique({
      where: { id: brandId },
      select: { id: true, projectId: true },
    })
    if (!existing) throw new NotFoundException('Brand not found')
    const [, brand] = await this.prisma.$transaction([
      this.prisma.translationValue.deleteMany({
        where: { projectId: existing.projectId, scope: brandId },
      }),
      this.prisma.brand.delete({ where: { id: brandId } }),
    ])
    await this.recordBrandChanged(brand.projectId)
  }

  /**
   * A brand change bumps the project version. Brand has no organizationId,
   * so it is looked up here; failures never fail the brand mutation.
   */
  private async recordBrandChanged(projectId: string) {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { organizationId: true },
      })
      if (!project) return
      void this.changes.recordChange({
        organizationId: project.organizationId,
        projectId,
        changes: [{ action: 'brand_changed' }],
      })
    } catch (error) {
      this.logger.error(
        `Failed to record brand change for project ${projectId}: ${String(error)}`
      )
    }
  }
}
