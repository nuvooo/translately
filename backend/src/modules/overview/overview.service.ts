import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma.service'
import { DEFAULT_SCOPE } from '../translations/limits'

export interface OverviewCounts {
  organizations: number
  projects: number
}

export interface OverviewProject {
  id: string
  name: string
  key: string
  type: string
  organizationId: string
  organizationName: string
  brandCount: number
  /** Translation keys of all namespaces. */
  keyCount: number
  /** Number of project languages. */
  languageCount: number
  /** Missing standard texts over all keys and project languages. */
  missingCount: number
  updatedAt: Date
}

export interface Overview {
  counts: OverviewCounts
  projects: OverviewProject[]
}

/**
 * Dashboard data across all organizations the user is a member of. Every
 * query is scoped to the ids derived from the caller's memberships, so other
 * tenants' data is never read. The number of queries is fixed (three) and does
 * not grow with the number of projects.
 */
@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(userId: string): Promise<Overview> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      select: {
        organizationId: true,
        organization: { select: { id: true, name: true } },
      },
    })
    const orgNames = new Map(
      memberships.map((m) => [m.organizationId, m.organization?.name ?? ''])
    )
    const counts: OverviewCounts = {
      organizations: orgNames.size,
      projects: 0,
    }
    if (orgNames.size === 0) return { counts, projects: [] }

    const projectRows = await this.prisma.project.findMany({
      where: { organizationId: { in: [...orgNames.keys()] } },
      select: {
        id: true,
        name: true,
        key: true,
        type: true,
        organizationId: true,
        languages: true,
        updatedAt: true,
        _count: {
          select: { brands: true, translationKeys: true },
        },
      },
      orderBy: { name: 'asc' },
    })
    const existing = await this.countStandardTexts(
      projectRows.map((p) => ({ id: p.id, languages: p.languages }))
    )

    const projects: OverviewProject[] = projectRows.map((p) => {
      const keyCount = p._count.translationKeys
      const expected = keyCount * p.languages.length
      return {
        id: p.id,
        name: p.name,
        key: p.key,
        type: p.type,
        organizationId: p.organizationId,
        organizationName: orgNames.get(p.organizationId) ?? '',
        brandCount: p._count.brands,
        keyCount,
        languageCount: p.languages.length,
        missingCount: Math.max(0, expected - (existing.get(p.id) ?? 0)),
        updatedAt: p.updatedAt,
      }
    })
    counts.projects = projects.length

    return { counts, projects }
  }

  /**
   * Existing standard texts per project, counting only rows whose language
   * is a project language (brand overrides are not counted). One grouped
   * query for all projects.
   */
  private async countStandardTexts(
    projects: { id: string; languages: string[] }[]
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    if (projects.length === 0) return result
    const projectIds = projects.map((p) => p.id)

    const languages = new Map(projects.map((p) => [p.id, p.languages]))

    const groups = await this.prisma.translationValue.groupBy({
      by: ['projectId', 'language'],
      where: { projectId: { in: projectIds }, scope: DEFAULT_SCOPE },
      _count: { _all: true },
    })
    for (const group of groups) {
      if (!languages.get(group.projectId)?.includes(group.language)) continue
      result.set(
        group.projectId,
        (result.get(group.projectId) ?? 0) + group._count._all
      )
    }
    return result
  }
}
