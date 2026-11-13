import { SDK_ERROR_CODES } from '../sdk/sdk.constants'
import { SdkService } from '../sdk/sdk.service'
import { computeSdkEtag, etagMatches } from '../sdk/sdk-etag'
import {
  extractEffectiveBrandKey,
  extractSdkApiKey,
  extractSdkOrigin,
  mapSdkError,
  setSdkCorsHeaders,
} from '../sdk/sdk-http.utils'
import { LANGUAGE_PATTERN, NAMESPACE_PATTERN } from './limits'
import { TranslationFilesService } from './translation-files.service'
import { buildTree } from './translation-tree'

/** i18next http backend: loadPath `…/sdk/translations/<project>/{{lng}}/{{ns}}`. */
export const TRANSLATIONS_ROUTE = '/sdk/translations/:projectKey/:lng/:ns'

/** Vary of a delivered file: the result depends on key and origin. */
const DELIVERY_VARY = 'Origin, X-API-Key, Authorization'
const DELIVERY_CACHE_CONTROL = 'private, no-cache'

export interface DeliveryDeps {
  sdkService: Pick<SdkService, 'resolveSdkAccess' | 'resolveBrandId'>
  files: Pick<TranslationFilesService, 'getFile'>
  changeEvents: {
    getVersion(projectId: string): Promise<number>
  }
  logger: { debug(m: string): void; error(m: string, ...r: unknown[]): void }
}

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/**
 * GET /sdk/translations/:projectKey/:lng/:ns — one language
 * file as nested i18next JSON. Order: API key/origin check → lng/ns check →
 * version → ETag (304 without loading the file) → brand → file. Never rejects.
 */
export async function handleTranslationsRequest(
  deps: DeliveryDeps,
  req: {
    params: Record<string, string>
    query: Record<string, unknown>
    headers: Record<string, string | string[] | undefined>
  },
  res: any
): Promise<void> {
  try {
    const projectKey = asString(req.params?.projectKey)
    const lng = asString(req.params?.lng)
    const rawNs = asString(req.params?.ns)
    const query = req.query ?? {}
    const brandKey = extractEffectiveBrandKey(query)
    const apiKey = extractSdkApiKey({ headers: req.headers ?? {}, query })
    const origin = extractSdkOrigin({ headers: req.headers ?? {}, query })

    setSdkCorsHeaders(res, origin)
    deps.logger.debug(
      `[SDK] Translations request: ${projectKey} (API key present: ${!!apiKey}, Origin: ${origin || 'none'})`
    )

    if (!apiKey) {
      res.status(401).json({
        error: 'API key required',
        code: SDK_ERROR_CODES.missingApiKey,
      })
      return
    }

    const access = await deps.sdkService.resolveSdkAccess(
      projectKey,
      apiKey,
      origin
    )
    const { project } = access

    const ns = rawNs.endsWith('.json') ? rawNs.slice(0, -'.json'.length) : rawNs
    if (
      !LANGUAGE_PATTERN.test(lng) ||
      !NAMESPACE_PATTERN.test(ns) ||
      !project.namespaces.includes(ns)
    ) {
      // i18next treats a missing file as an error; an empty one is harmless.
      res.setHeader('Cache-Control', DELIVERY_CACHE_CONTROL)
      res.status(200).json({})
      return
    }

    const version = await deps.changeEvents.getVersion(project.id)
    const etag = computeSdkEtag(
      version,
      {
        organizationId: access.organizationId,
        projectId: project.id,
      },
      [lng, ns, brandKey ?? '']
    )
    res.setHeader('ETag', etag)
    // Shared caches must never serve one key's response to another
    res.setHeader('Cache-Control', DELIVERY_CACHE_CONTROL)
    res.setHeader('Vary', DELIVERY_VARY)

    if (etagMatches(req.headers?.['if-none-match'], etag)) {
      res.status(304).end()
      return
    }

    const brandId = await deps.sdkService.resolveBrandId(project, brandKey)
    const file = await deps.files.getFile({
      project,
      namespace: ns,
      language: lng,
      brandId,
    })
    res.json(buildTree(file))
  } catch (error: unknown) {
    const err = (error ?? {}) as { status?: number; message?: string }
    try {
      // An error response must never be cached under a valid ETag
      res.removeHeader?.('ETag')
      const response = mapSdkError(err)
      const message =
        typeof err.message === 'string' ? err.message : String(error)
      if (response.status >= 500) {
        deps.logger.error('[SDK] Translations request failed:', message)
      } else {
        deps.logger.debug(`[SDK] Translations request rejected: ${message}`)
      }
      res.status(response.status).json(response.body)
    } catch {
      // Response already sent or the socket is gone: nothing left to do.
    }
  }
}
