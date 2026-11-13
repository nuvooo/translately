import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Project } from '../../domain/project.entity'
import { PrismaService } from '../../shared/prisma.service'
import { ChangeEventsService } from '../change-events/change-events.service'
import { deleteProjectChangeData } from '../change-events/project-cleanup'
import { CreateProjectDto } from './dto/create-project.dto'
import { UpdateProjectDto } from './dto/update-project.dto'

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ChangeEventsService
  ) {}

  async findAll(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: { include: { projects: true } } },
    })

    const projects = memberships.flatMap((m) => m.organization.projects)

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      key: p.key,
      description: p.description,
      type: p.type,
      allowedOrigins: p.allowedOrigins,
      languages: p.languages,
      namespaces: p.namespaces,
      organizationId: p.organizationId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }))
  }

  async findOne(projectId: string) {
    const p = await this.prisma.project.findUnique({
      where: { id: projectId },
    })

    if (!p) throw new NotFoundException('Project not found')

    return {
      id: p.id,
      name: p.name,
      key: p.key,
      description: p.description,
      type: p.type,
      allowedOrigins: p.allowedOrigins,
      languages: p.languages,
      namespaces: p.namespaces,
      organizationId: p.organizationId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }
  }

  async create(
    orgId: string,
    userId: string,
    dto: CreateProjectDto
  ): Promise<Project> {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        userId,
        organizationId: orgId,
        role: { in: ['OWNER', 'ADMIN'] },
      },
    })

    if (!membership) {
      throw new ForbiddenException('Access denied')
    }

    const normalizedKey = dto.key.trim().toLowerCase()

    const existing = await this.prisma.project.findUnique({
      where: {
        organizationId_key: { organizationId: orgId, key: normalizedKey },
      },
    })

    if (existing) {
      throw new ConflictException(
        `Project with key '${normalizedKey}' already exists`
      )
    }

    const project = Project.create({
      name: dto.name,
      key: normalizedKey,
      description: dto.description || null,
      type: dto.type || 'SINGLE',
      allowedOrigins: dto.allowedOrigins || [],
      organizationId: orgId,
    })

    const created = await this.prisma.project.create({
      data: {
        id: project.id,
        name: project.name,
        key: project.key,
        description: project.description,
        type: project.type,
        allowedOrigins: project.allowedOrigins,
        languages: project.languages,
        namespaces: project.namespaces,
        organizationId: project.organizationId,
      },
    })

    return Project.reconstitute({
      id: created.id,
      name: project.name,
      key: project.key,
      description: project.description,
      type: project.type,
      allowedOrigins: project.allowedOrigins,
      languages: created.languages,
      namespaces: created.namespaces,
      organizationId: project.organizationId,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    })
  }

  async update(projectId: string, dto: UpdateProjectDto) {
    // Copy only whitelisted fields. Never pass the request body straight to
    // Prisma: that would allow changing organizationId/key (mass assignment).
    const data: {
      name?: string
      description?: string
      type?: 'SINGLE' | 'MULTI'
      allowedOrigins?: string[]
    } = {}
    if (dto.name !== undefined) data.name = dto.name
    if (dto.description !== undefined) data.description = dto.description
    if (dto.type !== undefined) data.type = dto.type
    if (dto.allowedOrigins !== undefined) {
      data.allowedOrigins = [...dto.allowedOrigins]
    }

    // The type decides whether the delivery honours `?brandKey=`, so a real
    // change alters the project's files. Name, description and allowed
    // origins never change what a permitted request receives.
    const before =
      data.type === undefined
        ? null
        : await this.prisma.project.findUnique({
            where: { id: projectId },
            select: { type: true, organizationId: true },
          })

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data,
    })

    if (before && before.type !== updated.type) {
      await this.recordTypeChanged(before.organizationId, projectId)
    }

    return {
      id: updated.id,
      name: updated.name,
      key: updated.key,
      description: updated.description,
      type: updated.type,
      allowedOrigins: updated.allowedOrigins,
      languages: updated.languages,
      namespaces: updated.namespaces,
      organizationId: updated.organizationId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }
  }

  async findByOrganization(orgId: string) {
    const projects = await this.prisma.project.findMany({
      where: { organizationId: orgId },
    })

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      key: p.key,
      description: p.description,
      type: p.type,
      allowedOrigins: p.allowedOrigins,
      languages: p.languages,
      namespaces: p.namespaces,
      organizationId: p.organizationId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }))
  }

  async delete(projectId: string, userId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    })

    if (!project) {
      throw new NotFoundException('Project not found')
    }

    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        userId,
        organizationId: project.organizationId,
        role: { in: ['OWNER', 'ADMIN'] },
      },
    })

    if (!membership) {
      throw new ForbiddenException('Access denied')
    }

    // Delete all dependent data in a transaction (cascading delete for MongoDB)
    await this.prisma.$transaction(async (tx) => {
      // 1. Delete brands
      await tx.brand.deleteMany({ where: { projectId } })

      // 2. Delete audit logs
      await tx.auditLog.deleteMany({ where: { projectId } })

      // 3. Delete config versions, webhooks and webhook deliveries
      await deleteProjectChangeData(tx, projectId)

      // 4. Finally delete the project
      await tx.project.delete({ where: { id: projectId } })
    })
  }

  /** Bumps the project's version; failures never fail the update. */
  private async recordTypeChanged(organizationId: string, projectId: string) {
    try {
      await this.changes.recordChange({
        organizationId,
        projectId,
        changes: [{ action: 'brand_changed' }],
      })
    } catch (error) {
      this.logger.error(
        `Failed to record type change for project ${projectId}: ${String(error)}`
      )
    }
  }
}
