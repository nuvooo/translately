import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Organization, OrganizationRole } from '@prisma/client'
import { randomUUID } from 'crypto'
import { PrismaService } from '../../shared/prisma.service'
import { deleteProjectChangeData } from '../change-events/project-cleanup'

@Injectable()
export class OrganizationsService {
  private static readonly allowedRoles = new Set<OrganizationRole>([
    'OWNER',
    'ADMIN',
    'MEMBER',
    'VIEWER',
  ])

  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
    })

    // Get counts for each organization
    const orgsWithCounts = await Promise.all(
      memberships.map(async (m) => {
        const [memberCount, projectCount] = await Promise.all([
          this.prisma.organizationMember.count({
            where: { organizationId: m.organizationId },
          }),
          this.prisma.project.count({
            where: { organizationId: m.organizationId },
          }),
        ])

        return {
          ...m.organization,
          role: m.role,
          memberCount,
          projectCount,
        }
      })
    )

    return orgsWithCounts
  }

  async findOne(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
    })
    if (!org) throw new NotFoundException('Organization not found')
    return org
  }

  async findByUser(userId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId },
      include: { organization: true },
    })

    if (!membership) return null

    const [memberCount, projectCount] = await Promise.all([
      this.prisma.organizationMember.count({
        where: { organizationId: membership.organizationId },
      }),
      this.prisma.project.count({
        where: { organizationId: membership.organizationId },
      }),
    ])

    return {
      ...membership.organization,
      role: membership.role,
      memberCount,
      projectCount,
    }
  }

  async getStats(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: { include: { projects: true } } },
    })

    const projects = memberships.flatMap((m) => m.organization.projects)
    return {
      totalOrganizations: memberships.length,
      totalProjects: projects.length,
    }
  }

  async create(name: string, slug: string | undefined, userId: string) {
    // Always use UUID as slug for uniqueness
    const finalSlug = slug || randomUUID()

    let org: Organization
    try {
      org = await this.prisma.organization.create({
        data: {
          name,
          slug: finalSlug,
        },
      })
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('Organization slug is already taken')
      }
      throw error
    }

    await this.prisma.organizationMember.create({
      data: {
        userId,
        organizationId: org.id,
        role: 'OWNER',
      },
    })

    return org
  }

  async update(id: string, data: { name?: string; description?: string }) {
    return this.prisma.organization.update({
      where: { id },
      data,
    })
  }

  async delete(id: string) {
    // Get all projects for this organization
    const projects = await this.prisma.project.findMany({
      where: { organizationId: id },
      select: { id: true },
    })

    // Delete each project with all its dependencies
    for (const project of projects) {
      // Delete project data
      await this.prisma.brand.deleteMany({ where: { projectId: project.id } })
      await this.prisma.auditLog.deleteMany({
        where: { projectId: project.id },
      })
      await deleteProjectChangeData(this.prisma, project.id)
      await this.prisma.project.delete({ where: { id: project.id } })
    }

    // Delete organization-level data
    await this.prisma.auditLog.deleteMany({ where: { organizationId: id } })
    await this.prisma.apiKey.deleteMany({ where: { organizationId: id } })
    await this.prisma.organizationMember.deleteMany({
      where: { organizationId: id },
    })
    await this.prisma.organization.delete({ where: { id } })
  }

  async getMembers(orgId: string) {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    })

    return members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      name:
        `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() ||
        m.user.email,
      role: m.role,
      joinedAt: m.createdAt,
    }))
  }

  async getMember(orgId: string, userId: string) {
    return this.prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId },
    })
  }

  async countOwners(orgId: string) {
    return this.prisma.organizationMember.count({
      where: { organizationId: orgId, role: 'OWNER' },
    })
  }

  async updateMemberRole(memberId: string, role: string) {
    const updated = await this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { role: this.parseOrganizationRole(role) },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    })

    return {
      id: updated.id,
      userId: updated.userId,
      email: updated.user.email,
      firstName: updated.user.firstName,
      lastName: updated.user.lastName,
      name:
        `${updated.user.firstName ?? ''} ${updated.user.lastName ?? ''}`.trim() ||
        updated.user.email,
      role: updated.role,
    }
  }

  async removeMember(orgId: string, userId: string) {
    // Find the member first to ensure it exists
    const member = await this.prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId },
    })

    if (!member) {
      throw new NotFoundException('Member not found in organization')
    }

    // MCP keys act as their creator: they go with the membership, so they
    // cannot revive when the user is added again. Delete the membership by
    // unique ID for MongoDB compatibility.
    await this.prisma.$transaction([
      this.prisma.apiKey.deleteMany({
        where: { organizationId: orgId, userId, type: 'MCP' },
      }),
      this.prisma.organizationMember.delete({
        where: { id: member.id },
      }),
    ])
  }

  private parseOrganizationRole(role: string): OrganizationRole {
    if (!OrganizationsService.allowedRoles.has(role as OrganizationRole)) {
      throw new BadRequestException(`Invalid organization role: ${role}`)
    }

    return role as OrganizationRole
  }
}
