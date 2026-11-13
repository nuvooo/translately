import { Body, Controller, INestApplication, Post } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { GlobalExceptionFilter } from '../../shared/filters/global-exception.filter'
import { MCP_MAX_BODY_BYTES, registerMcpBodyParser } from './mcp-body-parser'

@Controller()
class EchoController {
  @Post('mcp')
  mcp(@Body() body: { data?: string }) {
    return { length: body.data?.length ?? 0 }
  }

  @Post('other')
  other(@Body() body: { data?: string }) {
    return { length: body.data?.length ?? 0 }
  }
}

describe('MCP body parser', () => {
  let app: INestApplication
  let baseUrl: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile()
    app = moduleRef.createNestApplication({ logger: false })
    registerMcpBodyParser(app, 'api')
    app.useGlobalFilters(new GlobalExceptionFilter())
    app.setGlobalPrefix('api')
    await app.listen(0, '127.0.0.1')
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1')
  })

  afterAll(async () => {
    await app.close()
  })

  const post = (path: string, size: number) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'x'.repeat(size) }),
    })

  it('limit is 1 MB', () => {
    expect(MCP_MAX_BODY_BYTES).toBe(1024 * 1024)
  })

  it('accepts a body of just under 1 MB on /api/mcp', async () => {
    const size = 1024 * 1024 - 100
    const response = await post('/api/mcp', size)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ length: size })
  })

  it('also accepts it with a trailing slash', async () => {
    const response = await post('/api/mcp/', 500 * 1024)
    expect(response.status).toBe(201)
  })

  it('rejects a body over 1 MB on /api/mcp with 413', async () => {
    const response = await post('/api/mcp', 1024 * 1024 + 100)
    expect(response.status).toBe(413)
  })

  it('leaves the default limit on other routes', async () => {
    expect((await post('/api/other', 50 * 1024)).status).toBe(201)
    expect((await post('/api/other', 200 * 1024)).status).toBe(413)
  })
})
