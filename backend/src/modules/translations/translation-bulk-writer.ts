import { Logger } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma.service'

/** One text to write: the unique row (key, language, scope) and its text. */
export interface ValueWrite {
  keyId: string
  projectId: string
  language: string
  scope: string
  value: string
}

/** Rows per write call (`createMany` or raw `update` command). */
export const UPDATE_CHUNK_SIZE = 5_000
/**
 * Estimated bytes per write call. MongoDB caps a command document at 16 MB
 * (and a wire message at 48 MB); half of that leaves room for the estimate's
 * slack. One row is at most MAX_VALUE_LENGTH * 3 bytes plus overhead, far
 * below the budget, so every chunk holds at least one row.
 */
export const WRITE_BYTE_BUDGET = 8 * 1024 * 1024
/** Generous per-row allowance for field names, ObjectIds, dates and BSON framing. */
export const STATEMENT_OVERHEAD_BYTES = 256
const VALUES_COLLECTION = 'translation_values'

/** Estimated BSON size of one row in a write call. */
export function estimateWriteBytes(row: ValueWrite): number {
  return (
    Buffer.byteLength(row.value, 'utf8') +
    Buffer.byteLength(row.language, 'utf8') +
    Buffer.byteLength(row.scope, 'utf8') +
    STATEMENT_OVERHEAD_BYTES
  )
}

/** Splits rows into chunks of at most UPDATE_CHUNK_SIZE rows and WRITE_BYTE_BUDGET estimated bytes. */
function chunkWrites(rows: ValueWrite[]): ValueWrite[][] {
  const chunks: ValueWrite[][] = []
  let chunk: ValueWrite[] = []
  let bytes = 0
  for (const row of rows) {
    const size = estimateWriteBytes(row)
    if (
      chunk.length > 0 &&
      (chunk.length >= UPDATE_CHUNK_SIZE || bytes + size > WRITE_BYTE_BUDGET)
    ) {
      chunks.push(chunk)
      chunk = []
      bytes = 0
    }
    chunk.push(row)
    bytes += size
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

/**
 * Set by writeValues before its first write call. Once set, texts may have
 * been written even if the call (or a later one) fails: a failing insert can
 * have stored the rows before a duplicate, a failing raw update the
 * statements without an error, and earlier chunks are not rolled back.
 */
export interface WriteProgress {
  started: boolean
}

interface RawUpdateResult {
  ok?: number
  n?: number
  writeErrors?: Array<{ index?: unknown; code?: unknown }>
}

/**
 * Writes texts in bulk with a number of write calls bounded by count and
 * size: `createMany` for rows that do not exist yet and raw `update`
 * commands for rows that exist and get a new text, each call carrying at
 * most UPDATE_CHUNK_SIZE rows and WRITE_BYTE_BUDGET estimated bytes. Never
 * deletes anything.
 *
 * A `createMany` that hits an existing row rejects with Prisma's `P2002`;
 * callers re-plan and retry. Error messages carry codes and indexes only,
 * never user text. `progress.started` tells callers whether a failure may
 * have left written texts behind (see WriteProgress).
 */
export async function writeValues(
  prisma: PrismaService,
  logger: Logger,
  creates: ValueWrite[],
  updates: ValueWrite[],
  userId: string,
  progress: WriteProgress = { started: false }
): Promise<void> {
  // Prisma sends createMany as one insert; chunking keeps each call small.
  for (const chunk of chunkWrites(creates)) {
    progress.started = true
    await prisma.translationValue.createMany({
      data: chunk.map((row) => ({ ...row, updatedById: userId })),
    })
  }

  // Prisma has no bulk update with per-row values on MongoDB; one raw
  // `update` command carries many statements (chunked to bound its size).
  // ObjectId fields and dates need extended JSON, or nothing would match.
  const now = { $date: new Date().toISOString() }
  for (const chunk of chunkWrites(updates)) {
    progress.started = true
    const result = (await prisma.$runCommandRaw({
      update: VALUES_COLLECTION,
      ordered: false,
      updates: chunk.map((row) => ({
        q: {
          keyId: { $oid: row.keyId },
          projectId: { $oid: row.projectId },
          language: row.language,
          scope: row.scope,
        },
        u: {
          $set: {
            value: row.value,
            updatedById: { $oid: userId },
            updatedAt: now,
          },
        },
      })),
    })) as RawUpdateResult | null

    const writeErrors = result?.writeErrors ?? []
    if (result?.ok !== 1 || writeErrors.length > 0) {
      const details = writeErrors
        .map((e) => `#${Number(e.index)} code ${Number(e.code)}`)
        .join(', ')
      throw new Error(
        `Bulk update of ${VALUES_COLLECTION} failed (ok=${Number(result?.ok)}${
          details ? `; ${details}` : ''
        })`
      )
    }
    const matched = Number(result.n ?? 0)
    if (matched < chunk.length) {
      // A row vanished between planning and writing (e.g. deleted meanwhile).
      logger.warn(
        `Bulk update of ${VALUES_COLLECTION} matched ${matched} of ${chunk.length} rows`
      )
    }
  }
}
