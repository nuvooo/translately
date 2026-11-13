import { Inject, Injectable, Optional } from '@nestjs/common'

/** Same cap as the UI routes that reach the paid AI provider. */
export const MCP_AI_CALLS_PER_WINDOW = 20
export const MCP_AI_WINDOW_MS = 60_000

/** Optional injection token for a clock (milliseconds), used by tests. */
export const MCP_AI_CLOCK = 'MCP_AI_CLOCK'

/**
 * In-memory rolling-window limit for MCP calls that reach the paid AI
 * translation, keyed by user so several MCP keys of one user share it.
 * Memory stays bounded: at most MCP_AI_CALLS_PER_WINDOW timestamps per user,
 * and users without a call in the window are dropped.
 */
@Injectable()
export class McpAiRateLimiter {
  private readonly calls = new Map<string, number[]>()
  private lastSweep = 0
  private readonly now: () => number

  constructor(@Optional() @Inject(MCP_AI_CLOCK) now?: () => number) {
    this.now = now ?? Date.now
  }

  /** Records a call and returns true, or returns false when the limit is reached. */
  tryConsume(userId: string): boolean {
    const now = this.now()
    this.sweep(now)
    const recent = (this.calls.get(userId) ?? []).filter(
      (t) => now - t < MCP_AI_WINDOW_MS
    )
    if (recent.length >= MCP_AI_CALLS_PER_WINDOW) {
      this.calls.set(userId, recent)
      return false
    }
    recent.push(now)
    this.calls.set(userId, recent)
    return true
  }

  /** Number of users currently tracked. */
  get size(): number {
    return this.calls.size
  }

  private sweep(now: number) {
    if (now - this.lastSweep < MCP_AI_WINDOW_MS) return
    this.lastSweep = now
    for (const [userId, times] of this.calls) {
      if (times.every((t) => now - t >= MCP_AI_WINDOW_MS)) {
        this.calls.delete(userId)
      }
    }
  }
}
