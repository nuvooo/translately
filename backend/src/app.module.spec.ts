import { Test } from '@nestjs/testing'
import { AppModule } from './app.module'
import { PrismaService } from './shared/prisma.service'

describe('AppModule', () => {
  it('resolves the complete dependency graph', async () => {
    const prismaStub = new Proxy({}, {
      get: (_t, prop) => (prop === 'then' ? undefined : jest.fn()),
    })
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .compile()
    expect(moduleRef.get(PrismaService)).toBe(prismaStub)
    await moduleRef.close()
  })
})
