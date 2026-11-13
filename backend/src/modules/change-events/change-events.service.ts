import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma.service'
import { CHANGE_BUS, ChangeBus } from './change-bus'
import {
  TranslationChange,
  TranslationsChangedEvent,
  RecordChangeInput,
} from './change-events.types'

/** Changes per project are collected this long. */
export const CHANGE_DEBOUNCE_MS = 2000
/** Max changes listed in one event; more sets `truncated: true`. */
export const MAX_EVENT_CHANGES = 100

interface PendingChanges {
  organizationId: string
  projectId: string
  /** dedupe key → change, in insertion order */
  changes: Map<string, TranslationChange>
  /** More distinct changes arrived than MAX_EVENT_CHANGES */
  truncated: boolean
  /** Last version seen at record time (fallback if the re-read fails) */
  version: number
  timer: ReturnType<typeof setTimeout>
}

/**
 * Tracks configuration versions per project and publishes
 * debounced `translations.changed` events on the ChangeBus. Recording is
 * best-effort: it never fails the mutation that triggered it.
 */
@Injectable()
export class ChangeEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(ChangeEventsService.name)
  private readonly pending = new Map<string, PendingChanges>()

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CHANGE_BUS) private readonly bus: ChangeBus
  ) {}

  /**
   * Call AFTER a mutation that can change delivered translations. Never
   * throws.
   */
  async recordChange(input: RecordChangeInput): Promise<void> {
    try {
      const version = await this.incrementVersion(input.projectId)
      this.buffer(input, version)
    } catch (error) {
      this.logger.error(
        `Failed to record change for project ${input.projectId}: ${String(error)}`
      )
    }
  }

  /** Current configuration version; 0 if nothing was ever recorded. */
  async getVersion(projectId: string): Promise<number> {
    const row = await this.prisma.configVersion.findUnique({
      where: { projectId },
      select: { version: true },
    })
    return row?.version ?? 0
  }

  async onModuleDestroy(): Promise<void> {
    await this.flushAll()
    await this.bus.close?.()
  }

  /** Publishes all pending events immediately. */
  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((key) => this.flush(key)))
  }

  /** Returns the new version, or 0 if the increment failed. */
  private async incrementVersion(projectId: string): Promise<number> {
    const upsert = () =>
      this.prisma.configVersion.upsert({
        where: { projectId },
        create: { projectId, version: 1 },
        update: { version: { increment: 1 } },
      })
    try {
      try {
        return (await upsert()).version
      } catch (error: any) {
        // Two concurrent first upserts race on the unique index: retry once
        if (error?.code !== 'P2002') throw error
        return (await upsert()).version
      }
    } catch (error) {
      this.logger.error(
        `Failed to increment config version (${projectId}): ${String(error)}`
      )
      return 0
    }
  }

  private buffer(input: RecordChangeInput, version: number) {
    const key = input.projectId
    let entry = this.pending.get(key)
    if (!entry) {
      // Fixed window from the first change: bounded latency even under a
      // constant stream of changes
      const timer = setTimeout(() => {
        void this.flush(key)
      }, CHANGE_DEBOUNCE_MS)
      timer.unref?.()
      entry = {
        organizationId: input.organizationId,
        projectId: input.projectId,
        changes: new Map(),
        truncated: false,
        version,
        timer,
      }
      this.pending.set(key, entry)
    }
    entry.version = Math.max(entry.version, version)

    for (const change of input.changes) {
      const dedupeKey = [
        change.namespace ?? '',
        change.key ?? '',
        change.language ?? '',
        change.action,
      ].join('\u0000')
      if (entry.changes.has(dedupeKey)) continue
      // Bounded memory: beyond the limit only remember that there was more
      if (entry.changes.size >= MAX_EVENT_CHANGES) {
        entry.truncated = true
        break
      }
      entry.changes.set(dedupeKey, {
        ...(change.key !== undefined && { key: change.key }),
        ...(change.namespace !== undefined && { namespace: change.namespace }),
        ...(change.language !== undefined && { language: change.language }),
        action: change.action,
      })
    }
  }

  private async flush(key: string): Promise<void> {
    const entry = this.pending.get(key)
    if (!entry) return
    this.pending.delete(key)
    clearTimeout(entry.timer)

    try {
      const [project, version] = await Promise.all([
        this.prisma.project.findUnique({
          where: { id: entry.projectId },
          select: { key: true },
        }),
        this.getVersion(entry.projectId).catch(() => entry.version),
      ])

      if (!project) {
        // Project deleted in the meantime: nobody can consume the event
        this.logger.debug(
          `Dropping change event for deleted project ${entry.projectId}`
        )
        return
      }

      const changes = [...entry.changes.values()]
      const event: TranslationsChangedEvent = {
        eventId: randomUUID(),
        organizationId: entry.organizationId,
        projectId: entry.projectId,
        projectKey: project.key,
        version: Math.max(version, entry.version),
        changes,
        ...(entry.truncated && { truncated: true }),
        createdAt: new Date().toISOString(),
      }
      await this.bus.publish(event)
    } catch (error) {
      this.logger.error(
        `Failed to publish change event for ${key}: ${String(error)}`
      )
    }
  }
}
