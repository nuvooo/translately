import { BadRequestException, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma.service'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { writeAudit } from '../audit-logs/write-audit'
import { ChangeEventsService } from '../change-events/change-events.service'
import { TranslationChange } from '../change-events/change-events.types'

/** Shared by the services that write texts of one translation key. */
export interface KeyRecord {
  id: string
  projectId: string
  organizationId: string
  namespace: string
  key: string
  description: string | null
  /** Missing on keys stored before locking existed; treated as unlocked. */
  locked?: boolean | null
}

export async function loadKey(
  prisma: PrismaService,
  keyId: string
): Promise<KeyRecord> {
  const key = await prisma.translationKey.findUnique({ where: { id: keyId } })
  if (!key) throw new NotFoundException('Translation key not found')
  return key
}

export async function loadProject(prisma: PrismaService, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      organizationId: true,
      type: true,
      languages: true,
      namespaces: true,
    },
  })
  if (!project) throw new NotFoundException('Project not found')
  return project
}

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002'
}

/** The brand of a MULTI project; SINGLE projects have no brands. */
export async function loadBrand(
  prisma: PrismaService,
  project: { id: string; type: string },
  brandId: string
): Promise<{ id: string; languages: string[] }> {
  if (project.type !== 'MULTI') {
    throw new BadRequestException('This project has no brands')
  }
  const brand = await prisma.brand.findFirst({
    where: { id: brandId, projectId: project.id },
    select: { id: true, languages: true },
  })
  if (!brand) throw new NotFoundException('Brand not found')
  return brand
}

/** Fire-and-forget change event for one key. */
export function recordKeyChange(
  changes: ChangeEventsService,
  key: KeyRecord,
  change: TranslationChange
) {
  void changes.recordChange({
    organizationId: key.organizationId,
    projectId: key.projectId,
    changes: [change],
  })
}

export function auditKeyAction(
  auditLogs: AuditLogsService,
  logger: Logger,
  action: string,
  key: KeyRecord,
  userId: string,
  oldValues: Record<string, unknown> | undefined,
  newValues?: Record<string, unknown>
) {
  return writeAudit(auditLogs, logger, {
    action,
    entityType: 'TranslationKey',
    entityId: key.id,
    userId,
    organizationId: key.organizationId,
    projectId: key.projectId,
    oldValues,
    newValues,
  })
}
