import { OverviewService } from './overview.service'

type Row = Record<string, any>
type Where = Record<string, any>

/** Matches the simple `where` shapes the service uses (equality and `in`). */
function matches(row: Row, where: Where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === 'object' && 'in' in condition) {
      return (condition.in as unknown[]).includes(row[key])
    }
    return row[key] === condition
  })
}

/** In-memory stand-in for the Prisma models read by the service. */
function fakePrisma(data: Record<string, Row[]>) {
  const model = (name: string) => ({
    findMany: jest.fn(async (args: any = {}) => {
      let rows = (data[name] ?? []).filter((r) => matches(r, args.where))
      if (args.orderBy?.name === 'asc') {
        rows = [...rows].sort((a, b) => a.name.localeCompare(b.name))
      }
      return rows.map((r) => {
        const out: Row = {}
        for (const [key, wanted] of Object.entries(args.select ?? {})) {
          if (key === '_count') {
            out._count = {
              brands: (data.brand ?? []).filter((b) => b.projectId === r.id)
                .length,
              translationKeys: (data.translationKey ?? []).filter(
                (k) => k.projectId === r.id
              ).length,
            }
          } else if (key === 'organization') {
            out.organization = (data.organization ?? []).find(
              (o) => o.id === r.organizationId
            )
          } else if (wanted) {
            out[key] = r[key]
          }
        }
        return args.select ? out : { ...r }
      })
    }),
    groupBy: jest.fn(async (args: any) => {
      const groups = new Map<string, Row>()
      const rows = (data[name] ?? []).filter((r) => matches(r, args.where))
      for (const r of rows) {
        const id = args.by.map((field: string) => r[field]).join('|')
        const group = groups.get(id) ?? {
          ...Object.fromEntries(args.by.map((f: string) => [f, r[f]])),
          _count: { _all: 0 },
        }
        group._count._all++
        groups.set(id, group)
      }
      return [...groups.values()]
    }),
  })
  return {
    organizationMember: model('organizationMember'),
    project: model('project'),
    translationValue: model('translationValue'),
  }
}

const day = (n: number) => new Date(Date.UTC(2026, 0, n))

/** Two tenants: Alice is in org A only, Bob in org B only. */
function twoTenants() {
  return {
    organization: [
      { id: 'org-a', name: 'Acme' },
      { id: 'org-b', name: 'Globex' },
    ],
    organizationMember: [
      { userId: 'alice', organizationId: 'org-a', role: 'OWNER' },
      { userId: 'bob', organizationId: 'org-b', role: 'OWNER' },
    ],
    project: [
      {
        id: 'p-a1',
        name: 'Shop',
        key: 'shop',
        type: 'SINGLE',
        organizationId: 'org-a',
        languages: [] as string[],
        updatedAt: day(1),
      },
      {
        id: 'p-a2',
        name: 'App',
        key: 'app',
        type: 'MULTI',
        organizationId: 'org-a',
        languages: ['de'],
        updatedAt: day(2),
      },
      {
        id: 'p-b1',
        name: 'Secret',
        key: 'secret',
        type: 'SINGLE',
        organizationId: 'org-b',
        languages: ['en'],
        updatedAt: day(3),
      },
    ],
    brand: [
      { id: 'b-a2-1', projectId: 'p-a2', key: 'one' },
      { id: 'b-a2-2', projectId: 'p-a2', key: 'two' },
      { id: 'b-b1-1', projectId: 'p-b1', key: 'hidden' },
    ],
    translationKey: [{ id: 'k-b1-1', projectId: 'p-b1' }],
    translationValue: [] as Row[],
  }
}

const serviceFor = (data = twoTenants()) => {
  const prisma = fakePrisma(data)
  return { prisma, service: new OverviewService(prisma as any) }
}

describe('OverviewService', () => {
  it('counts only data of the organizations the user is a member of', async () => {
    const { service } = serviceFor()
    const overview = await service.getOverview('alice')
    expect(overview.counts).toEqual({
      organizations: 1,
      projects: 2,
    })
  })

  it('never returns projects of other tenants', async () => {
    const alice = await serviceFor().service.getOverview('alice')
    expect(alice.projects.map((p) => p.id).sort()).toEqual(['p-a1', 'p-a2'])
    expect(JSON.stringify(alice)).not.toMatch(/Secret|Globex/)

    const bob = await serviceFor().service.getOverview('bob')
    expect(bob.projects.map((p) => p.id)).toEqual(['p-b1'])
    expect(bob.projects[0].brandCount).toBe(1)
    expect(bob.counts).toEqual({
      organizations: 1,
      projects: 1,
    })
  })

  it('scopes every query to the caller memberships', async () => {
    const { prisma, service } = serviceFor()
    await service.getOverview('alice')
    expect(prisma.organizationMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'alice' } })
    )
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: { in: ['org-a'] } } })
    )
  })

  it('returns projects with organization name and counts (no environmentCount)', async () => {
    const { projects } = await serviceFor().service.getOverview('alice')
    expect(projects).toEqual([
      {
        id: 'p-a2',
        name: 'App',
        key: 'app',
        type: 'MULTI',
        organizationId: 'org-a',
        organizationName: 'Acme',
        brandCount: 2,
        keyCount: 0,
        languageCount: 1,
        missingCount: 0,
        updatedAt: day(2),
      },
      {
        id: 'p-a1',
        name: 'Shop',
        key: 'shop',
        type: 'SINGLE',
        organizationId: 'org-a',
        organizationName: 'Acme',
        brandCount: 0,
        keyCount: 0,
        languageCount: 0,
        missingCount: 0,
        updatedAt: day(1),
      },
    ])
  })

  it('returns an empty overview for users without organizations', async () => {
    const { prisma, service } = serviceFor()
    const overview = await service.getOverview('nobody')
    expect(overview).toEqual({
      counts: {
        organizations: 0,
        projects: 0,
      },
      projects: [],
    })
    expect(prisma.project.findMany).not.toHaveBeenCalled()
  })

  it('returns zero counts for organizations without projects', async () => {
    const data = twoTenants()
    data.project = data.project.filter((p) => p.organizationId !== 'org-a')
    const { service } = serviceFor(data)
    const overview = await service.getOverview('alice')
    expect(overview.counts).toEqual({
      organizations: 1,
      projects: 0,
    })
    expect(overview.projects).toEqual([])
  })

  describe('translation counts', () => {
    /** p-a1: 3 keys, languages de/en. */
    function withTexts(values: Row[]) {
      const data = twoTenants()
      data.project[0].languages = ['de', 'en']
      data.translationKey = [
        { id: 'k1', projectId: 'p-a1' },
        { id: 'k2', projectId: 'p-a1' },
        { id: 'k3', projectId: 'p-a1' },
        { id: 'k-b1-1', projectId: 'p-b1' },
      ]
      data.translationValue = values
      return serviceFor(data)
    }
    const text = (
      keyId: string,
      language: string,
      scope = 'default',
      projectId = 'p-a1'
    ) => ({ keyId, language, scope, projectId })

    it('missingCount = keys x languages - existing default texts (3x2 - 4 = 2)', async () => {
      const { service } = withTexts([
        text('k1', 'de'),
        text('k1', 'en'),
        text('k2', 'de'),
        text('k3', 'en'),
      ])

      const { projects } = await service.getOverview('alice')
      const shop = projects.find((p) => p.id === 'p-a1')

      expect(shop).toEqual(
        expect.objectContaining({
          keyCount: 3,
          languageCount: 2,
          missingCount: 2,
        })
      )
    })

    it('ignores brand overrides and languages outside the project list', async () => {
      const { service } = withTexts([
        text('k1', 'de'),
        text('k1', 'de', 'b-a2-1'),
        text('k1', 'fr'),
        text('k2', 'fr'),
      ])

      const { projects } = await service.getOverview('alice')

      expect(projects.find((p) => p.id === 'p-a1')?.missingCount).toBe(5)
    })

    it('never returns a negative missingCount', async () => {
      const { service } = withTexts([
        text('k1', 'de'),
        text('k1', 'en'),
        text('k2', 'de'),
        text('k2', 'en'),
        text('k3', 'de'),
        text('k3', 'en'),
        // orphaned extra row (e.g. of a key deleted meanwhile)
        text('k9', 'en'),
      ])

      const { projects } = await service.getOverview('alice')

      expect(projects.find((p) => p.id === 'p-a1')?.missingCount).toBe(0)
    })

    it('uses a fixed number of queries scoped to the visible projects', async () => {
      const { prisma, service } = withTexts([])

      await service.getOverview('alice')

      expect(prisma.organizationMember.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.project.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.translationValue.groupBy).toHaveBeenCalledTimes(1)
      expect(prisma).not.toHaveProperty('environment')
      expect(prisma.translationValue.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: { in: ['p-a2', 'p-a1'] }, scope: 'default' },
        })
      )
    })
  })
})
