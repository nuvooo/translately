import { MAX_VALUE_LENGTH } from './limits'
import {
  applyRawValueUpdate,
  FakeValueRow,
} from './testing/fake-raw-value-update'
import {
  estimateWriteBytes,
  STATEMENT_OVERHEAD_BYTES,
  UPDATE_CHUNK_SIZE,
  ValueWrite,
  WRITE_BYTE_BUDGET,
  writeValues,
} from './translation-bulk-writer'

const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const SECRET_TEXT = 'geheimer Nutzertext'

const keyId = (i: number) => i.toString(16).padStart(24, '0')

function row(i: number, value = `Text ${i}`): ValueWrite {
  return {
    keyId: keyId(i),
    projectId: PROJECT_ID,
    language: 'de',
    scope: 'default',
    value,
  }
}

function setup() {
  const rows: FakeValueRow[] = []
  const prisma: any = {
    translationValue: {
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data) rows.push({ ...d })
        return { count: data.length }
      }),
      deleteMany: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
    $runCommandRaw: jest.fn(async (command: any) =>
      applyRawValueUpdate(rows, command)
    ),
  }
  const logger: any = { warn: jest.fn(), error: jest.fn() }
  const seed = (i: number, value = 'Alt') =>
    rows.push({ ...row(i, value), updatedById: null })
  return { prisma, logger, rows, seed }
}

describe('writeValues', () => {
  it('creates new rows in one createMany call with the acting user', async () => {
    const { prisma, logger, rows } = setup()

    await writeValues(prisma, logger, [row(1), row(2)], [], USER_ID)

    expect(prisma.translationValue.createMany).toHaveBeenCalledTimes(1)
    expect(prisma.translationValue.createMany).toHaveBeenCalledWith({
      data: [
        { ...row(1), updatedById: USER_ID },
        { ...row(2), updatedById: USER_ID },
      ],
    })
    expect(rows).toHaveLength(2)
    expect(prisma.$runCommandRaw).not.toHaveBeenCalled()
  })

  it('overwrites changed rows with an encoded raw update', async () => {
    const { prisma, logger, rows, seed } = setup()
    seed(1)

    await writeValues(prisma, logger, [], [row(1, 'Neu')], USER_ID)

    expect(prisma.translationValue.createMany).not.toHaveBeenCalled()
    expect(rows[0]).toMatchObject({ value: 'Neu', updatedById: USER_ID })
    const command = prisma.$runCommandRaw.mock.calls[0][0]
    expect(command).toMatchObject({
      update: 'translation_values',
      ordered: false,
    })
    expect(command.updates[0]).toEqual({
      q: {
        keyId: { $oid: keyId(1) },
        projectId: { $oid: PROJECT_ID },
        language: 'de',
        scope: 'default',
      },
      u: {
        $set: {
          value: 'Neu',
          updatedById: { $oid: USER_ID },
          updatedAt: { $date: expect.any(String) },
        },
      },
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('makes no call at all for empty input', async () => {
    const { prisma, logger } = setup()
    await writeValues(prisma, logger, [], [], USER_ID)
    expect(prisma.translationValue.createMany).not.toHaveBeenCalled()
    expect(prisma.$runCommandRaw).not.toHaveBeenCalled()
  })

  it(`chunks updates by ${UPDATE_CHUNK_SIZE} statements`, async () => {
    const { prisma, logger, rows, seed } = setup()
    const updates: ValueWrite[] = []
    for (let i = 0; i < 12_000; i++) {
      seed(i)
      updates.push(row(i, `Neu ${i}`))
    }

    await writeValues(prisma, logger, [], updates, USER_ID)

    expect(UPDATE_CHUNK_SIZE).toBe(5_000)
    const sizes = prisma.$runCommandRaw.mock.calls.map(
      ([command]: any) => command.updates.length
    )
    expect(sizes).toEqual([5_000, 5_000, 2_000])
    expect(rows.every((r) => r.value.startsWith('Neu '))).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('warns with the two counts, without user text, when fewer rows matched', async () => {
    const { prisma, logger, seed } = setup()
    seed(1)

    await writeValues(
      prisma,
      logger,
      [],
      [row(1, SECRET_TEXT), row(2, SECRET_TEXT)],
      USER_ID
    )

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'Bulk update of translation_values matched 1 of 2 rows'
    )
  })

  describe('size budget', () => {
    // '€' is one UTF-16 unit but three UTF-8 bytes: the most bytes a text of
    // MAX_VALUE_LENGTH units can have (a 4-byte emoji takes two units).
    const longText = '€'.repeat(MAX_VALUE_LENGTH)
    const emojiText = '😀'.repeat(MAX_VALUE_LENGTH / 2)
    const MONGO_COMMAND_LIMIT = 16 * 1024 * 1024

    it('names the budget constants and estimates a row by its UTF-8 size', () => {
      expect(WRITE_BYTE_BUDGET).toBe(8 * 1024 * 1024)
      expect(STATEMENT_OVERHEAD_BYTES).toBe(256)
      expect(longText).toHaveLength(MAX_VALUE_LENGTH)
      expect(emojiText).toHaveLength(MAX_VALUE_LENGTH)
      expect(estimateWriteBytes(row(1, longText))).toBe(
        3 * MAX_VALUE_LENGTH + 256 + 2 + 7
      )
      expect(estimateWriteBytes(row(1, emojiText))).toBe(
        2 * MAX_VALUE_LENGTH + 256 + 2 + 7
      )
    })

    it.each([
      ['3-byte', longText],
      ['4-byte emoji', emojiText],
    ])(
      'splits 3,000 updates of maximal %s texts into commands within the budget',
      async (_name, text) => {
        const { prisma, logger, rows, seed } = setup()
        const updates: ValueWrite[] = []
        for (let i = 0; i < 3_000; i++) {
          seed(i)
          updates.push(row(i, text))
        }

        await writeValues(prisma, logger, [], updates, USER_ID)

        const commands = prisma.$runCommandRaw.mock.calls.map(([c]: any) => c)
        expect(commands.length).toBeGreaterThan(1)
        let statements = 0
        for (const command of commands) {
          statements += command.updates.length
          const estimate = command.updates.reduce(
            (sum: number, u: any) =>
              sum +
              Buffer.byteLength(u.u.$set.value, 'utf8') +
              Buffer.byteLength(u.q.language, 'utf8') +
              Buffer.byteLength(u.q.scope, 'utf8') +
              STATEMENT_OVERHEAD_BYTES,
            0
          )
          expect(estimate).toBeLessThanOrEqual(WRITE_BYTE_BUDGET)
          expect(
            Buffer.byteLength(JSON.stringify(command), 'utf8')
          ).toBeLessThan(MONGO_COMMAND_LIMIT)
        }
        expect(statements).toBe(3_000)
        expect(rows.every((r) => r.value === text)).toBe(true)
        expect(logger.warn).not.toHaveBeenCalled()
      }
    )

    it.each([
      ['3-byte', longText],
      ['4-byte emoji', emojiText],
    ])(
      'splits 3,000 new rows of maximal %s texts into createMany calls within the budget',
      async (_name, text) => {
        const { prisma, logger, rows } = setup()
        const creates: ValueWrite[] = []
        for (let i = 0; i < 3_000; i++) creates.push(row(i, text))

        await writeValues(prisma, logger, creates, [], USER_ID)

        const calls = prisma.translationValue.createMany.mock.calls
        expect(calls.length).toBeGreaterThan(1)
        for (const [{ data }] of calls) {
          const estimate = data.reduce(
            (sum: number, d: ValueWrite) => sum + estimateWriteBytes(d),
            0
          )
          expect(estimate).toBeLessThanOrEqual(WRITE_BYTE_BUDGET)
        }
        expect(rows).toHaveLength(3_000)
        expect(
          rows.every((r) => r.value === text && r.updatedById === USER_ID)
        ).toBe(true)
      }
    )

    it(`also caps createMany calls at ${UPDATE_CHUNK_SIZE} short rows`, async () => {
      const { prisma, logger } = setup()
      const creates: ValueWrite[] = []
      for (let i = 0; i < 12_000; i++) creates.push(row(i))

      await writeValues(prisma, logger, creates, [], USER_ID)

      expect(
        prisma.translationValue.createMany.mock.calls.map(
          ([{ data }]: any) => data.length
        )
      ).toEqual([5_000, 5_000, 2_000])
    })
  })

  it('throws on write errors with codes and indexes only', async () => {
    const { prisma, logger } = setup()
    prisma.$runCommandRaw.mockResolvedValue({
      ok: 1,
      n: 0,
      writeErrors: [{ index: 3, code: 121, errmsg: SECRET_TEXT }],
    })

    const error = await writeValues(
      prisma,
      logger,
      [],
      [row(1, SECRET_TEXT)],
      USER_ID
    ).catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('121')
    expect((error as Error).message).toContain('3')
    expect((error as Error).message).not.toContain(SECRET_TEXT)
  })

  it('throws when the command is not acknowledged', async () => {
    const { prisma, logger } = setup()
    prisma.$runCommandRaw.mockResolvedValue({ ok: 0, errmsg: SECRET_TEXT })

    const error = await writeValues(
      prisma,
      logger,
      [],
      [row(1)],
      USER_ID
    ).catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain(SECRET_TEXT)
  })

  it('never deletes anything', async () => {
    const { prisma, logger, seed } = setup()
    seed(1)
    await writeValues(prisma, logger, [row(2)], [row(1, 'Neu')], USER_ID)
    expect(prisma.translationValue.deleteMany).not.toHaveBeenCalled()
    expect(prisma.translationValue.delete).not.toHaveBeenCalled()
  })
})

describe('applyRawValueUpdate (test fake)', () => {
  const valid = () => ({
    q: {
      keyId: { $oid: keyId(1) },
      projectId: { $oid: PROJECT_ID },
      language: 'de',
      scope: 'default',
    },
    u: {
      $set: {
        value: 'x',
        updatedById: { $oid: USER_ID },
        updatedAt: { $date: new Date().toISOString() },
      },
    },
  })
  const run = (statement: any) =>
    applyRawValueUpdate([], {
      update: 'translation_values',
      updates: [statement],
    })

  it('accepts a correctly encoded statement', () => {
    expect(run(valid())).toEqual({ ok: 1, n: 0, nModified: 0 })
  })

  it.each(['keyId', 'projectId'])('rejects a plain string as %s', (field) => {
    const statement: any = valid()
    statement.q[field] = statement.q[field].$oid
    expect(() => run(statement)).toThrow(field)
  })

  it('rejects a plain string as updatedById and updatedAt', () => {
    const a: any = valid()
    a.u.$set.updatedById = USER_ID
    expect(() => run(a)).toThrow('updatedById')
    const b: any = valid()
    b.u.$set.updatedAt = new Date().toISOString()
    expect(() => run(b)).toThrow('updatedAt')
  })
})
