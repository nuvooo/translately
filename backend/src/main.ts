import { INestApplication, Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
import { AppModule } from './app.module'
import { ChangeEventsService } from './modules/change-events/change-events.service'
import {
  SDK_CORS_ALLOWED_HEADERS,
  SDK_CORS_EXPOSED_HEADERS,
} from './modules/sdk/sdk.constants'
import { SdkService } from './modules/sdk/sdk.service'
import { setSdkCorsHeaders } from './modules/sdk/sdk-http.utils'
import { registerMcpBodyParser } from './modules/mcp/mcp-body-parser'
import { registerImportBodyParser } from './modules/translations/import-body-parser'
import { TranslationFilesService } from './modules/translations/translation-files.service'
import {
  DeliveryDeps,
  handleTranslationsRequest,
  TRANSLATIONS_ROUTE,
} from './modules/translations/translations-delivery'
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter'
import { MetricsService } from './shared/metrics/metrics.service'
import {
  assertSecureConfig,
  createIpRateLimiter,
  isOriginAllowed,
  isSdkPath,
  parseOriginList,
  redactUrl,
} from './shared/security/http-security'

const GLOBAL_PREFIX = 'api'

async function bootstrap() {
  // Refuse to boot in production with a missing/weak JWT secret
  assertSecureConfig()

  const app = await NestFactory.create(AppModule)
  // SIGTERM/SIGINT: onModuleDestroy hooks run before the HTTP server closes
  // (pending change events are flushed)
  app.enableShutdownHooks()
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER))
  const logger = new Logger('Bootstrap')
  const isProduction = process.env.NODE_ENV === 'production'
  const swaggerEnabled = !isProduction || process.env.ENABLE_SWAGGER === 'true'

  // Behind reverse proxies (Traefik/nginx) req.ip must be the real client IP,
  // otherwise all clients share one rate-limit bucket. By default only
  // private-network hops are trusted, so X-Forwarded-For cannot be spoofed.
  app
    .getHttpAdapter()
    .getInstance()
    .set(
      'trust proxy',
      process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal'
    )

  // Swagger UI needs relaxed CSP (inline scripts) — apply BEFORE helmet
  app.use((req: any, res: any, next: any) => {
    if (swaggerEnabled && req.path && req.path.startsWith('/api/swagger')) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; style-src * 'unsafe-inline'; img-src * data:; script-src * 'unsafe-inline'; connect-src *; font-src * data:"
      )
      return next()
    }
    return helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })(
      req,
      res,
      next
    )
  })

  // CORS for the dashboard API. SDK routes are called from customer websites
  // and are restricted per project via allowedOrigins instead.
  const corsOrigins = parseOriginList(process.env.CORS_ORIGINS)
  const allowAll = corsOrigins.includes('*')

  if (allowAll) {
    logger.warn('[CORS] CORS_ORIGINS=* allows every origin for the API')
  } else if (corsOrigins.length === 0) {
    logger.log(
      isProduction
        ? '[CORS] No CORS_ORIGINS configured: same-origin requests only'
        : '[CORS] No CORS_ORIGINS configured: allowing localhost (dev)'
    )
  }

  const corsHeaders = [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-Requested-With',
  ]
  const apiCors = cors({
    origin: (origin, callback) => {
      // Requests without Origin (same-origin, curl, server-side)
      if (!origin || allowAll) return callback(null, true)

      if (!isProduction && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true)
      }

      if (isOriginAllowed(origin, corsOrigins)) return callback(null, true)

      logger.warn(`[CORS] Blocked origin: ${origin}`)
      // No CORS headers -> the browser blocks the response
      callback(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: corsHeaders,
  })
  const sdkCors = cors({
    origin: true,
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    // Includes If-None-Match for conditional requests (ETag revalidation)
    allowedHeaders: SDK_CORS_ALLOWED_HEADERS.split(', '),
    exposedHeaders: SDK_CORS_EXPOSED_HEADERS.split(', '),
  })
  app.use((req: any, res: any, next: any) =>
    isSdkPath(req.path) ? sdkCors(req, res, next) : apiCors(req, res, next)
  )

  // Never log query strings (may contain API keys) or path tokens
  morgan.token('safe-url', (req: any) => redactUrl(req.originalUrl || req.url))
  app.use(
    morgan(
      ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":user-agent"'
    )
  )

  // JSON limit of 2 MB for the two translation import routes only; Nest's
  // default parser (registered later, in init) handles every other route.
  registerImportBodyParser(app, GLOBAL_PREFIX)
  // JSON limit of 1 MB for the MCP endpoint only
  registerMcpBodyParser(app, GLOBAL_PREFIX)

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.useGlobalFilters(new GlobalExceptionFilter())

  // Register standalone routes BEFORE global prefix
  const httpAdapter = app.getHttpAdapter()

  // Health endpoint
  httpAdapter.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Prometheus metrics endpoint (outside /api prefix). Protected by
  // METRICS_TOKEN; without a token it is disabled in production.
  const metricsService = app.get(MetricsService)
  const metricsToken = process.env.METRICS_TOKEN
  httpAdapter.get('/metrics', async (req, res) => {
    if (metricsToken) {
      if (req.headers.authorization !== `Bearer ${metricsToken}`) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
    } else if (isProduction) {
      return res.status(404).json({ error: 'Not found' })
    }
    const metrics = await metricsService.getMetrics()
    res.set('Content-Type', metricsService.getContentType())
    res.set('Cache-Control', 'no-store')
    res.send(metrics)
  })

  // SDK endpoints registered as raw HTTP handlers — ThrottlerGuard (APP_GUARD)
  // does NOT apply here because these bypass the NestJS controller layer,
  // so they get their own per-IP limit.
  app.use(
    '/sdk',
    createIpRateLimiter({
      windowMs: 60_000,
      limit: Number(process.env.SDK_RATE_LIMIT_PER_MINUTE) || 600,
    })
  )

  // Language files for i18next's http backend (…/{{lng}}/{{ns}}). Conditional
  // requests: ETag = project version + file shape, If-None-Match → 304
  // after the key/origin check, before the file is loaded.
  const translationsDeps: DeliveryDeps = {
    sdkService: app.get(SdkService),
    files: app.get(TranslationFilesService),
    changeEvents: app.get(ChangeEventsService),
    logger: new Logger('SdkTranslations'),
  }
  httpAdapter.options(TRANSLATIONS_ROUTE, (req, res) => {
    setSdkCorsHeaders(res, req.headers.origin as string | undefined)
    res.status(200).send()
  })
  httpAdapter.get(TRANSLATIONS_ROUTE, (req, res) =>
    handleTranslationsRequest(translationsDeps, req, res)
  )

  // Set global prefix BEFORE creating Swagger document so paths are correct
  app.setGlobalPrefix(GLOBAL_PREFIX)

  if (swaggerEnabled) {
    setupSwagger(app)
  }

  const port = process.env.PORT || 4000
  await app.listen(port, '0.0.0.0')
  logger.log(`🚀 Translately API running on http://0.0.0.0:${port}`)
}

/** Swagger/OpenAPI docs; disabled in production unless ENABLE_SWAGGER=true. */
function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Translately API')
    .setDescription(`Translation Management API

## Authentication
1. Login with POST /api/auth/login (email + password)
2. Copy the token from the response
3. Click "Authorize" button and enter: Bearer {token}`)
    .setVersion('2.0')
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, config)

  // Manually add endpoints to Swagger
  document.paths['/api/auth/login'] = {
    post: {
      tags: ['Auth'],
      summary: 'Login with email and password',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                email: { type: 'string', example: 'user@example.com' },
                password: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Returns JWT token' },
        '401': { description: 'Invalid credentials' },
      },
    },
  }

  const sdkPathParameter = (name: string, description: string) => ({
    name,
    in: 'path' as const,
    required: true,
    description,
    schema: { type: 'string' as const },
  })
  document.paths['/sdk/translations/{projectKey}/{lng}/{ns}'] = {
    get: {
      tags: ['SDK'],
      summary: 'Get one language file as nested i18next JSON',
      description:
        'Use as i18next-http-backend loadPath. Authenticated by API key ' +
        '(header x-api-key, Authorization: Bearer or query apiKey). ' +
        'Supports conditional requests via ETag / If-None-Match. An ' +
        'invalid or unknown language or namespace yields {}.',
      parameters: [
        sdkPathParameter('projectKey', 'Project key'),
        sdkPathParameter('lng', 'Language code (case-sensitive, e.g. de)'),
        sdkPathParameter(
          'ns',
          'Namespace, optionally with .json suffix (e.g. translation)'
        ),
        {
          name: 'brandKey',
          in: 'query',
          required: false,
          description: 'Brand key or id (MULTI projects)',
          schema: { type: 'string' },
        },
        {
          name: 'apiKey',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'x-api-key',
          in: 'header',
          required: false,
          schema: { type: 'string' },
        },
      ],
      responses: {
        '200': {
          description: 'Nested i18next JSON (may be {})',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        '304': { description: 'Not modified (If-None-Match matched)' },
        '401': { description: 'Missing or invalid API key' },
        '403': { description: 'Origin not allowed' },
        '429': { description: 'Rate limit exceeded' },
      },
    },
  }

  SwaggerModule.setup('api/swagger', app, document, {
    customSiteTitle: 'Translately API Docs',

    swaggerOptions: {
      url: '/api/swagger-json', // wichtig!
    },

    customCssUrl:
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css',

    customJs: [
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js',
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js',
    ],

    // 🔥 verhindert lokale swagger-ui-init.js Nutzung
    customJsStr: `
    window.onload = function() {
      const ui = SwaggerUIBundle({
        url: "/api/swagger-json",
        dom_id: '#swagger-ui',
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "StandaloneLayout"
      });
      window.ui = ui;
    };
  `,
  })
}

bootstrap()
