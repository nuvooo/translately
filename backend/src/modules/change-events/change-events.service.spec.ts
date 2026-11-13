import { InMemoryChangeBus } from './change-bus'
import {
  CHANGE_DEBOUNCE_MS,
  ChangeEventsService,
  MAX_EVENT_CHANGES,
} from './change-events.service'
import { TranslationsChangedEvent } from './change-events.types'

const P = 'aaaaaaaaaaaaaaaaaaaaaaaa'

function createPrismaMock() {
  const versions = new Map<string, number>()
  return {
    versions,
    configVersion: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const k = where.projectId
        const version = (versions.get(k) ?? create.version - 1) + 1
        versions.set(k, version)
        return { version }
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        versions.has(where.projectId)
          ? { version: versions.get(where.projectId) }
          : null
      ),
    },
    project: {
      findUnique: jest.fn(async () => ({ key: 'shop' })),
    },
  }
}

async function settle() {
  // Let pending promise chains (flush → bus) complete
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('ChangeEventsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>
  let bus: InMemoryChangeBus
  let service: ChangeEventsService
  let events: TranslationsChangedEvent[]

  beforeEach(() => {
    jest.useFakeTimers()
    prisma = createPrismaMock()
    bus = new InMemoryChangeBus()
    events = []
    bus.subscribe((e) => events.push(e))
    service = new ChangeEventsService(prisma as any, bus)
    jest.spyOn((service as any).logger, 'error').mockImplementation()
    jest.spyOn((service as any).logger, 'warn').mockImplementation()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('increments the project version by exactly 1 per recordChange', async () => {
    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes: [{ key: 'a', action: 'updated' }],
    })
    expect(await service.getVersion(P)).toBe(1)
    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes: [{ key: 'a', action: 'updated' }],
    })

    expect(prisma.configVersion.upsert).toHaveBeenCalledWith({
      where: { projectId: P },
      create: { projectId: P, version: 1 },
      update: { version: { increment: 1 } },
    })
    expect(prisma.configVersion.upsert).toHaveBeenCalledTimes(2)
    expect(await service.getVersion(P)).toBe(2)
  })

  it('returns version 0 for unknown projects', async () => {
    expect(await service.getVersion('cccccccccccccccccccccccc')).toBe(0)
  })

  it('publishes one debounced, deduplicated event per project', async () => {
    const base = { organizationId: 'org', projectId: P }
    await service.recordChange({
      ...base,
      changes: [{ key: 'a', action: 'updated' }],
    })
    await service.recordChange({
      ...base,
      changes: [
        { key: 'a', action: 'updated' },
        { key: 'b', action: 'updated' },
      ],
    })

    jest.advanceTimersByTime(CHANGE_DEBOUNCE_MS - 1)
    await settle()
    expect(events).toHaveLength(0)

    jest.advanceTimersByTime(1)
    await settle()

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      organizationId: 'org',
      projectId: P,
      projectKey: 'shop',
      version: 2,
      changes: [
        { key: 'a', action: 'updated' },
        { key: 'b', action: 'updated' },
      ],
    })
    expect(events[0]).not.toHaveProperty('environmentId')
    expect(events[0]).not.toHaveProperty('environmentKey')
    expect(events[0].truncated).toBeUndefined()
    expect(events[0].eventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(new Date(events[0].createdAt).toString()).not.toBe('Invalid Date')
  })

  it('keeps changes with the same key and action but different language', async () => {
    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes: [
        { key: 'a.b', namespace: 'translation', language: 'de', action: 'updated' },
        { key: 'a.b', namespace: 'translation', language: 'en', action: 'updated' },
        { key: 'a.b', namespace: 'translation', language: 'de', action: 'updated' },
      ],
    })
    jest.advanceTimersByTime(CHANGE_DEBOUNCE_MS)
    await settle()

    expect(events[0].changes).toEqual([
      { key: 'a.b', namespace: 'translation', language: 'de', action: 'updated' },
      { key: 'a.b', namespace: 'translation', language: 'en', action: 'updated' },
    ])
  })

  it('truncates more than MAX_EVENT_CHANGES changes', async () => {
    const changes = Array.from({ length: MAX_EVENT_CHANGES + 5 }, (_, i) => ({
      key: `f${i}`,
      action: 'updated' as const,
    }))
    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes,
    })
    jest.advanceTimersByTime(CHANGE_DEBOUNCE_MS)
    await settle()

    expect(events[0].changes).toHaveLength(MAX_EVENT_CHANGES)
    expect(events[0].truncated).toBe(true)
  })

  it('stops collecting changes beyond the limit (bounded memory)', async () => {
    const changes = Array.from({ length: 5000 }, (_, i) => ({
      key: `f${i}`,
      action: 'updated' as const,
    }))
    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes,
    })
    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes: [{ key: 'late', action: 'deleted' }],
    })

    const pending = [...(service as any).pending.values()][0]
    expect(pending.changes.size).toBe(MAX_EVENT_CHANGES)
    expect(pending.truncated).toBe(true)

    jest.advanceTimersByTime(CHANGE_DEBOUNCE_MS)
    await settle()
    expect(events[0].changes).toHaveLength(MAX_EVENT_CHANGES)
    expect(events[0].truncated).toBe(true)
  })

  it('does not mark exactly MAX_EVENT_CHANGES changes as truncated', async () => {
    const changes = Array.from({ length: MAX_EVENT_CHANGES }, (_, i) => ({
      key: `f${i}`,
      action: 'updated' as const,
    }))
    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes: [...changes, ...changes],
    })
    jest.advanceTimersByTime(CHANGE_DEBOUNCE_MS)
    await settle()
    expect(events[0].changes).toHaveLength(MAX_EVENT_CHANGES)
    expect(events[0].truncated).toBeUndefined()
  })

  it('retries the upsert once when two first upserts race (P2002)', async () => {
    const race = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    })
    prisma.configVersion.upsert
      .mockRejectedValueOnce(race)
      .mockResolvedValueOnce({ version: 2 })

    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes: [{ key: 'a', action: 'updated' }],
    })

    expect(prisma.configVersion.upsert).toHaveBeenCalledTimes(2)
    expect((service as any).logger.error).not.toHaveBeenCalled()
    expect([...(service as any).pending.values()][0].version).toBe(2)
  })

  it('does not retry other upsert errors', async () => {
    prisma.configVersion.upsert.mockRejectedValueOnce(new Error('db down'))
    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes: [{ key: 'a', action: 'updated' }],
    })
    expect(prisma.configVersion.upsert).toHaveBeenCalledTimes(1)
    expect((service as any).logger.error).toHaveBeenCalled()
  })

  it('never throws when the database fails', async () => {
    prisma.configVersion.upsert.mockRejectedValue(new Error('db down'))

    await expect(
      service.recordChange({
        organizationId: 'org',
        projectId: P,
        changes: [{ key: 'a', action: 'updated' }],
      })
    ).resolves.toBeUndefined()
  })

  it('swallows errors while flushing', async () => {
    prisma.project.findUnique.mockRejectedValue(new Error('db down'))
    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes: [{ key: 'a', action: 'updated' }],
    })
    jest.advanceTimersByTime(CHANGE_DEBOUNCE_MS)
    await settle()
    expect(events).toHaveLength(0)
    expect((service as any).logger.error).toHaveBeenCalled()
  })

  it('flushes pending changes on module destroy', async () => {
    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes: [{ key: 'a', action: 'deleted' }],
    })

    await service.onModuleDestroy()

    expect(events).toHaveLength(1)
    expect(events[0].changes).toEqual([{ key: 'a', action: 'deleted' }])
  })

  it('does not keep the process alive with debounce timers', async () => {
    const unref = jest.fn()
    const spy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((_fn: any) => ({ unref }) as any) as any)
    await service.recordChange({
      organizationId: 'org',
      projectId: P,
      changes: [{ key: 'a', action: 'updated' }],
    })
    expect(unref).toHaveBeenCalled()
    spy.mockRestore()
  })
})
