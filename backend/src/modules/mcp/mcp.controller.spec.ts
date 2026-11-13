import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { currentActor } from '../../shared/actor-context'
import { ANTHROPIC_CLIENT } from '../ai-translation/ai-translation.constants'
import { McpModule } from './mcp.module'
import { McpContext, McpKeyResolver } from './mcp-key.resolver'
import { McpToolError, McpToolsService } from './mcp-tools.service'

const VALID_TOKEN = 'tkm_valid'

function contextFor(token: string): McpContext {
  return {
    apiKeyId: `key-${token}`,
    apiKeyName: `Key ${token}`,
    userId: 'user-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    role: 'MEMBER',
  }
}

describe('McpController (e2e with MCP SDK client)', () => {
  let app: INestApplication
  let baseUrl: string
  let clients: Client[]

  const resolver = {
    resolve: jest.fn(async (header?: string) => {
      const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1]
      if (!token?.startsWith('tkm_')) {
        throw new UnauthorizedException('Invalid API key')
      }
      return contextFor(token)
    }),
  }

  const tools = {
    getProject: jest.fn(),
    listKeys: jest.fn(),
    getKey: jest.fn(),
    createKey: jest.fn(),
    updateKey: jest.fn(),
    setTranslations: jest.fn(),
    translateMissing: jest.fn(),
    deleteKey: jest.fn(),
    addLanguage: jest.fn(),
  }

  /** Boots a fresh app (fresh in-memory throttler storage). */
  async function startApp() {
    await app?.close()
    const moduleRef = await Test.createTestingModule({
      imports: [
        // Same global throttler setup as AppModule: 100 req/min per IP
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
        McpModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .overrideProvider(McpKeyResolver)
      .useValue(resolver)
      .overrideProvider(McpToolsService)
      .useValue(tools)
      .overrideProvider(ANTHROPIC_CLIENT)
      .useValue(null)
      // Dependencies of the imported modules (Prisma, audit logs, ...) are irrelevant here
      .useMocker(() => ({}))
      .compile()

    app = moduleRef.createNestApplication({ logger: false })
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    baseUrl = `http://127.0.0.1:${address.port}`
  }

  beforeAll(startApp)

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    clients = []
  })

  afterEach(async () => {
    await Promise.all(clients.map((c) => c.close()))
  })

  async function connect(token = VALID_TOKEN): Promise<Client> {
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/api/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    )
    await client.connect(transport)
    clients.push(client)
    return client
  }

  function textOf(result: unknown): string {
    return (result as { content: { type: string; text: string }[] }).content[0]
      .text
  }

  function ping(token?: string) {
    return fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
  }

  it('lists exactly the 9 tools with descriptions and hints', async () => {
    const client = await connect()

    const { tools: listed } = await client.listTools()

    expect(listed.map((t) => t.name).sort()).toEqual(
      [
        'add_language',
        'create_key',
        'delete_key',
        'get_key',
        'get_project',
        'list_keys',
        'set_translations',
        'translate_missing',
        'update_key',
      ].sort()
    )
    for (const tool of listed) {
      expect(tool.description).toBeTruthy()
    }
    const byName = Object.fromEntries(listed.map((t) => [t.name, t]))
    for (const name of ['get_project', 'list_keys', 'get_key']) {
      expect(byName[name].annotations?.readOnlyHint).toBe(true)
    }
    expect(byName.delete_key.annotations?.destructiveHint).toBe(true)
  })

  it('announces the server name and instructions', async () => {
    const client = await connect()
    expect(client.getServerVersion()?.name).toBe('translately')
    expect(client.getInstructions()).toContain('get_project')
  })

  it('create_key and set_translations call the tools service with the key context', async () => {
    tools.createKey.mockResolvedValue({
      key: 'home.title',
      namespace: 'translation',
      written: ['de'],
    })
    tools.setTranslations.mockResolvedValue({ written: 1, unchanged: 0 })
    const client = await connect()

    const created = await client.callTool({
      name: 'create_key',
      arguments: { key: 'home.title', values: { de: 'Start' } },
    })
    const set = await client.callTool({
      name: 'set_translations',
      arguments: { entries: [{ key: 'home.title', values: { en: 'Home' } }] },
    })

    const ctx = contextFor(VALID_TOKEN)
    expect(tools.createKey).toHaveBeenCalledWith(ctx, {
      key: 'home.title',
      values: { de: 'Start' },
    })
    expect(tools.setTranslations).toHaveBeenCalledWith(ctx, {
      entries: [{ key: 'home.title', values: { en: 'Home' } }],
    })
    expect(created.isError).toBeFalsy()
    expect(JSON.parse(textOf(created))).toEqual({
      key: 'home.title',
      namespace: 'translation',
      written: ['de'],
    })
    expect(JSON.parse(textOf(set))).toEqual({ written: 1, unchanged: 0 })
  })

  it('create_key rejects extra fields before reaching the service', async () => {
    const client = await connect()

    const result = await client.callTool({
      name: 'create_key',
      arguments: { key: 'sneaky', projectId: 'other-project' },
    })

    expect(result.isError).toBe(true)
    expect(tools.createKey).not.toHaveBeenCalled()
  })

  it('set_translations rejects more than 50 entries before reaching the service', async () => {
    const client = await connect()
    const entries = Array.from({ length: 51 }, (_, i) => ({
      key: `k${i}`,
      values: { de: 'x' },
    }))

    const result = await client.callTool({
      name: 'set_translations',
      arguments: { entries },
    })

    expect(result.isError).toBe(true)
    expect(tools.setTranslations).not.toHaveBeenCalled()
  })

  it('delete_key defaults confirm to false', async () => {
    tools.deleteKey.mockResolvedValue({
      wouldDelete: { key: 'home.title', texts: 2 },
    })
    const client = await connect()

    await client.callTool({
      name: 'delete_key',
      arguments: { key: 'home.title' },
    })

    expect(tools.deleteKey).toHaveBeenCalledWith(contextFor(VALID_TOKEN), {
      key: 'home.title',
      confirm: false,
    })
  })

  it('get_project works without arguments', async () => {
    tools.getProject.mockResolvedValue({ project: { key: 'shop' } })
    const client = await connect()

    const result = await client.callTool({ name: 'get_project' })

    expect(result.isError).toBeFalsy()
    expect(tools.getProject).toHaveBeenCalledWith(contextFor(VALID_TOKEN))
    expect(JSON.parse(textOf(result))).toEqual({ project: { key: 'shop' } })
  })

  it('a tool error is returned as isError result, not as HTTP error', async () => {
    tools.getKey.mockRejectedValue(
      new McpToolError('Key "nope" not found in namespace "translation"')
    )
    const client = await connect()

    const result = await client.callTool({
      name: 'get_key',
      arguments: { key: 'nope' },
    })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      'Key "nope" not found in namespace "translation"'
    )
  })

  it('unexpected errors become a generic isError result', async () => {
    tools.listKeys.mockRejectedValue(new Error('PrismaClientKnownRequestError'))
    const client = await connect()

    const result = await client.callTool({ name: 'list_keys', arguments: {} })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Internal error while running tool')
  })

  it('missing or invalid bearer → HTTP 401 with JSON-RPC error and WWW-Authenticate', async () => {
    const missing = await ping()
    const invalid = await ping('not-an-mcp-key')

    for (const res of [missing, invalid]) {
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toBe('Bearer')
      const body = await res.json()
      expect(body).toEqual({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null,
      })
    }
    expect(tools.getProject).not.toHaveBeenCalled()
  })

  it.each(['GET', 'DELETE'])('%s /api/mcp → 405', async (method) => {
    const res = await fetch(`${baseUrl}/api/mcp`, {
      method,
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    })

    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
    const body = await res.json()
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error).toEqual(expect.objectContaining({ code: -32000 }))
  })

  it('the audit actor is set during tool execution', async () => {
    tools.createKey.mockImplementation(async () => currentActor())
    const client = await connect()

    const result = await client.callTool({
      name: 'create_key',
      arguments: { key: 'audited' },
    })

    expect(JSON.parse(textOf(result))).toEqual({
      apiKeyId: `key-${VALID_TOKEN}`,
      apiKeyName: `Key ${VALID_TOKEN}`,
    })
    expect(currentActor()).toBeUndefined()
  })

  describe('rate limits', () => {
    // Each test gets its own app so the throttler buckets do not couple
    beforeEach(startApp)

    it('limits each token to 120 requests per minute, independent of the per-IP default', async () => {
      const statuses: number[] = []
      for (let i = 0; i < 121; i++) {
        statuses.push((await ping('tkm_rate_a')).status)
      }

      // The global default (100/min per IP) must not apply to /api/mcp
      expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true)
      expect(statuses[120]).toBe(429)

      // Same IP, different token → separate bucket
      expect((await ping('tkm_rate_b')).status).toBe(200)
    })

    it('limits each IP to 600 requests per minute, even with distinct invalid tokens', async () => {
      const statuses: number[] = []
      for (let i = 0; i < 601; i++) {
        statuses.push((await ping(`bogus-${i}-${Math.random()}`)).status)
      }

      expect(statuses.slice(0, 600).every((s) => s === 401)).toBe(true)
      expect(statuses[600]).toBe(429)
      // The IP limit is checked before authentication (no key lookup)
      expect(resolver.resolve).toHaveBeenCalledTimes(600)
    })
  })
})
