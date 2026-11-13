import {
  MCP_AI_CALLS_PER_WINDOW,
  MCP_AI_WINDOW_MS,
  McpAiRateLimiter,
} from './mcp-ai-rate-limiter'

describe('McpAiRateLimiter', () => {
  it('allows 20 calls per user within 60 s and refuses the 21st', () => {
    let now = 1_000
    const limiter = new McpAiRateLimiter(() => now)
    for (let i = 0; i < MCP_AI_CALLS_PER_WINDOW; i++) {
      expect(limiter.tryConsume('u1')).toBe(true)
      now += 100
    }
    expect(limiter.tryConsume('u1')).toBe(false)
  })

  it('allows calls again once the oldest leave the rolling window', () => {
    let now = 0
    const limiter = new McpAiRateLimiter(() => now)
    for (let i = 0; i < MCP_AI_CALLS_PER_WINDOW; i++) limiter.tryConsume('u1')
    now = MCP_AI_WINDOW_MS - 1
    expect(limiter.tryConsume('u1')).toBe(false)
    now = MCP_AI_WINDOW_MS
    expect(limiter.tryConsume('u1')).toBe(true)
  })

  it('keeps separate budgets per user', () => {
    const limiter = new McpAiRateLimiter(() => 0)
    for (let i = 0; i < MCP_AI_CALLS_PER_WINDOW; i++) limiter.tryConsume('u1')
    expect(limiter.tryConsume('u1')).toBe(false)
    expect(limiter.tryConsume('u2')).toBe(true)
  })

  it('a refused call does not use up budget', () => {
    let now = 0
    const limiter = new McpAiRateLimiter(() => now)
    for (let i = 0; i < MCP_AI_CALLS_PER_WINDOW; i++) limiter.tryConsume('u1')
    now = 30_000
    expect(limiter.tryConsume('u1')).toBe(false)
    now = MCP_AI_WINDOW_MS
    expect(limiter.tryConsume('u1')).toBe(true)
  })

  it('drops users whose calls have all expired', () => {
    let now = 0
    const limiter = new McpAiRateLimiter(() => now)
    for (let i = 0; i < 100; i++) limiter.tryConsume(`u${i}`)
    expect(limiter.size).toBe(100)
    now = MCP_AI_WINDOW_MS * 2
    limiter.tryConsume('other')
    expect(limiter.size).toBe(1)
  })

  it('uses Date.now without an injected clock', () => {
    const limiter = new McpAiRateLimiter()
    expect(limiter.tryConsume('u1')).toBe(true)
  })
})
