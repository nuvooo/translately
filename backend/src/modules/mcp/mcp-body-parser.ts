import { INestApplication, PayloadTooLargeException } from '@nestjs/common'
import { json, NextFunction, Request, Response } from 'express'

export const MCP_MAX_BODY_BYTES = 1024 * 1024

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Raises the JSON body limit to 1 MB for `POST /<prefix>/mcp` only (tool calls
 * with up to 50 entries of long texts exceed Nest's default of about 100 kB);
 * every other route keeps Nest's default parser. Same mechanism as the import
 * body parser: register before the app is initialised, the body is parsed
 * once and Nest's own parser skips it.
 */
export function registerMcpBodyParser(
  app: INestApplication,
  globalPrefix: string
): void {
  const prefix = globalPrefix ? `/${escapeRegExp(globalPrefix)}` : ''
  const mcpPath = new RegExp(`^${prefix}/mcp/?$`, 'i')
  const parser = json({ limit: MCP_MAX_BODY_BYTES })

  app.use(function mcpJsonParser(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    if (req.method !== 'POST' || !mcpPath.test(req.path)) return next()
    parser(req, res, (error?: unknown) => {
      if (
        (error as { type?: string } | undefined)?.type === 'entity.too.large'
      ) {
        return next(new PayloadTooLargeException('Request body too large'))
      }
      next(error)
    })
  })
}
