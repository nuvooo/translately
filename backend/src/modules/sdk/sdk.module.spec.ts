import { Global, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService } from '../../shared/prisma.service'
import { SdkModule } from './sdk.module'
import { SdkService } from './sdk.service'

@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: {} }],
  exports: [PrismaService],
})
class FakeInfrastructureModule {}

describe('SdkModule', () => {
  it('provides SdkService with only PrismaService as dependency', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeInfrastructureModule, SdkModule],
    }).compile()

    expect(moduleRef.get(SdkService)).toBeInstanceOf(SdkService)

    await moduleRef.close()
  })
})
