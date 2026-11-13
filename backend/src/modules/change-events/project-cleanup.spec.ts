import { deleteProjectChangeData } from './project-cleanup'

function createDb(webhookIds: string[] = []) {
  return {
    apiKey: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    configVersion: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    webhook: {
      findMany: jest.fn().mockResolvedValue(webhookIds.map((id) => ({ id }))),
      deleteMany: jest.fn().mockResolvedValue({ count: webhookIds.length }),
    },
    webhookDelivery: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    translationValue: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    translationKey: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as any
}

describe('deleteProjectChangeData', () => {
  it('removes the MCP keys bound to the project (and only those)', async () => {
    const db = createDb([])

    await deleteProjectChangeData(db, 'proj-1')

    expect(db.apiKey.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1', type: 'MCP' },
    })
  })

  it('removes config versions, webhook deliveries and webhooks of the project', async () => {
    const db = createDb(['wh-1', 'wh-2'])

    await deleteProjectChangeData(db, 'proj-1')

    expect(db.configVersion.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
    })
    expect(db.webhook.findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
      select: { id: true },
    })
    expect(db.webhookDelivery.deleteMany).toHaveBeenCalledWith({
      where: { webhookId: { in: ['wh-1', 'wh-2'] } },
    })
    expect(db.webhook.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
    })
  })

  it('deletes deliveries before their webhooks', async () => {
    const db = createDb(['wh-1'])
    const order: string[] = []
    db.webhookDelivery.deleteMany.mockImplementation(async () => {
      order.push('deliveries')
    })
    db.webhook.deleteMany.mockImplementation(async () => {
      order.push('webhooks')
    })

    await deleteProjectChangeData(db, 'proj-1')

    expect(order).toEqual(['deliveries', 'webhooks'])
  })

  it('skips the delivery cleanup when the project has no webhooks', async () => {
    const db = createDb([])

    await deleteProjectChangeData(db, 'proj-1')

    expect(db.webhookDelivery.deleteMany).not.toHaveBeenCalled()
    expect(db.configVersion.deleteMany).toHaveBeenCalled()
  })

  it('deletes the project translation values, then its keys (scoped by projectId)', async () => {
    const db = createDb([])
    const order: string[] = []
    db.translationValue.deleteMany.mockImplementation(async () => {
      order.push('values')
      return { count: 3 }
    })
    db.translationKey.deleteMany.mockImplementation(async () => {
      order.push('keys')
      return { count: 1 }
    })

    await deleteProjectChangeData(db, 'proj-1')

    expect(db.translationValue.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
    })
    expect(db.translationKey.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
    })
    expect(order).toEqual(['values', 'keys'])
  })
})
