import { PrismaService } from './prisma.service'

describe('PrismaService', () => {
  it('connects on init without touching any collection', async () => {
    const service = new PrismaService()
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined)
    const runCommandRaw = jest.spyOn(service, '$runCommandRaw')

    await service.onModuleInit()

    expect(connect).toHaveBeenCalledTimes(1)
    expect(runCommandRaw).not.toHaveBeenCalled()
  })

  it('disconnects on destroy', async () => {
    const service = new PrismaService()
    const disconnect = jest
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined)

    await service.onModuleDestroy()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
