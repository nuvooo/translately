import { INestApplication, PayloadTooLargeException } from '@nestjs/common'
import { json } from 'express'
import { MAX_IMPORT_BYTES } from './limits'

export const IMPORT_TOO_LARGE_MESSAGE = 'Datei zu groß (max. 2 MB)'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Raises the JSON body limit to MAX_IMPORT_BYTES for exactly the two import
 * routes (`POST /<prefix>/projects/:projectId/translations/import[/preview]`);
 * every other route keeps Nest's default parser (about 100 kB).
 *
 * Must be registered before the app is initialised: `app.use` middleware runs
 * before the parsers Nest adds in `init()`. Once this parser has read the
 * body, the request stream is finished and Nest's own JSON parser skips it,
 * so the body is parsed once. The function is not named `jsonParser`, so
 * Nest still registers its default parser for all other routes.
 */
export function registerImportBodyParser(
  app: INestApplication,
  globalPrefix: string
): void {
  const prefix = globalPrefix ? `/${escapeRegExp(globalPrefix)}` : ''
  // Case-insensitive and with optional trailing slash, like Express routing.
  const importPath = new RegExp(
    `^${prefix}/projects/[^/]+/translations/import(?:/preview)?/?$`,
    'i'
  )
  const parser = json({ limit: MAX_IMPORT_BYTES })

  app.use(function importJsonParser(req: any, res: any, next: any) {
    if (req.method !== 'POST' || !importPath.test(req.path)) return next()
    parser(req, res, (error?: any) => {
      if (error?.type === 'entity.too.large') {
        // Reported through the global exception filter as 413.
        return next(new PayloadTooLargeException(IMPORT_TOO_LARGE_MESSAGE))
      }
      next(error)
    })
  })
}
