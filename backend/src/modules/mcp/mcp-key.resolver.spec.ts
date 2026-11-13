import { UnauthorizedException } from '@nestjs/common'
import { hashApiKey } from '../api-keys/api-keys.service'
import { McpKeyResolver } from './mcp-key.resolver'

const KEY = `tkm_${'a'.repeat(64)}`

function validKey(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    name: 'My MCP',
    key: 'tkm_aaa…aaaa',
    keyHash: hashApiKey(KEY),
    type: 'MCP',
    isActive: true,
    expiresAt: null,
    userId: 'user-1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    lastUsedAt: null,
    ...overrides,
  }
}

function setup(
  key: Record<string, unknown> | null = validKey(),
  user: Record<string, unknown> | null = { id: 'user-1', isActive: true },
  member: Record<string, unknown> | null = { role: 'ADMIN' },
  project: Record<string, unknown> | null = { id: 'proj-1' }
) {
  const prisma = {
    apiKey: {
      findFirst: jest.fn().mockResolvedValue(key),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    organizationMember: { findUnique: jest.fn().mockResolvedValue(member) },
    project: { findFirst: jest.fn().mockResolvedValue(project) },
  } as any
  return { prisma, resolver: new McpKeyResolver(prisma) }
}

const reject = (resolver: McpKeyResolver, header?: string) =>
  expect(resolver.resolve(header)).rejects.toBeInstanceOf(UnauthorizedException)

describe('McpKeyResolver', () => {
  it.each([
    ['missing header', undefined],
    ['non-bearer header', `Basic ${KEY}`],
    ['wrong prefix', 'Bearer tk_abc'],
  ])('rejects %s without a lookup', async (_n, header) => {
    const { resolver, prisma } = setup()
    await reject(resolver, header)
    expect(prisma.apiKey.findFirst).not.toHaveBeenCalled()
  })

  it('rejects an unknown key and looks it up by hash only', async () => {
    const { resolver, prisma } = setup(null)
    await reject(resolver, `Bearer ${KEY}`)
    expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({
      where: { keyHash: hashApiKey(KEY) },
    })
  })

  it.each([
    ['wrong type', { type: 'SERVER' }],
    ['inactive', { isActive: false }],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }],
    ['missing userId', { userId: null }],
    ['missing projectId', { projectId: null }],
  ])('rejects key: %s', async (_n, override) => {
    const { resolver } = setup(validKey(override))
    await reject(resolver, `Bearer ${KEY}`)
  })

  it('rejects an inactive user', async () => {
    const { resolver } = setup(validKey(), { id: 'user-1', isActive: false })
    await reject(resolver, `Bearer ${KEY}`)
  })

  it('rejects a missing user', async () => {
    const { resolver } = setup(validKey(), null)
    await reject(resolver, `Bearer ${KEY}`)
  })

  it('rejects a user who is no longer a member of the organization', async () => {
    const { resolver } = setup(validKey(), undefined, null)
    await reject(resolver, `Bearer ${KEY}`)
  })

  it('rejects a key whose project no longer exists in its organization', async () => {
    const { resolver, prisma } = setup(validKey(), undefined, undefined, null)
    await reject(resolver, `Bearer ${KEY}`)
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'proj-1', organizationId: 'org-1' },
      select: { id: true },
    })
    expect(prisma.apiKey.update).not.toHaveBeenCalled()
  })

  it('returns the context with the current organization role', async () => {
    const { resolver, prisma } = setup()
    await expect(resolver.resolve(`Bearer ${KEY}`)).resolves.toEqual({
      apiKeyId: 'key-1',
      apiKeyName: 'My MCP',
      userId: 'user-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      role: 'ADMIN',
    })
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: 'user-1', organizationId: 'org-1' },
      },
    })
  })

  it('updates lastUsedAt when older than 60s', async () => {
    const { resolver, prisma } = setup(
      validKey({ lastUsedAt: new Date(Date.now() - 61_000) })
    )
    await resolver.resolve(`Bearer ${KEY}`)
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { lastUsedAt: expect.any(Date) },
    })
  })

  it('updates lastUsedAt when never used', async () => {
    const { resolver, prisma } = setup()
    await resolver.resolve(`Bearer ${KEY}`)
    expect(prisma.apiKey.update).toHaveBeenCalledTimes(1)
  })

  it('does not update lastUsedAt when younger than 60s', async () => {
    const { resolver, prisma } = setup(
      validKey({ lastUsedAt: new Date(Date.now() - 10_000) })
    )
    await resolver.resolve(`Bearer ${KEY}`)
    expect(prisma.apiKey.update).not.toHaveBeenCalled()
  })

  it('does not fail when the lastUsedAt update rejects', async () => {
    const { resolver, prisma } = setup()
    prisma.apiKey.update.mockRejectedValue(new Error('db down'))
    await expect(resolver.resolve(`Bearer ${KEY}`)).resolves.toBeDefined()
  })
})
