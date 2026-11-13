import { createHmac, timingSafeEqual } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import {
  deliveryErrorLabel,
  SIGNATURE_SNIPPET,
  WEBHOOK_EVENT_TYPES,
  webhookErrorMessage,
} from './webhooks'

const axiosError = (status: number, data: unknown) => ({
  isAxiosError: true,
  message: `Request failed with status code ${status}`,
  response: { status, data },
})

describe('webhook helpers', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de')
  })

  it('names the change event translations.changed', () => {
    // Same names as the backend (webhook-payload.ts WebhookEventType)
    expect(WEBHOOK_EVENT_TYPES).toEqual([
      'translations.changed',
      'webhook.test',
    ])
  })

  it.each([
    ['blocked_private_address', /private oder interne adressen/i],
    ['insecure_scheme', /https/i],
    ['credentials_in_url', /benutzernamen/i],
    ['invalid_url', /keine gültige url/i],
    ['webhook_limit_reached', /maximale anzahl/i],
  ])('maps API code %s to a friendly message', (code, expected) => {
    const message = webhookErrorMessage(axiosError(400, { message: 'raw', code }), i18n.t)
    expect(message).toMatch(expected)
    expect(message).not.toBe('raw')
  })

  it('falls back to the server message for unknown codes', () => {
    expect(webhookErrorMessage(axiosError(400, { message: 'url must be a URL' }), i18n.t)).toBe('url must be a URL')
  })

  it('maps conflicts and rate limits', () => {
    expect(webhookErrorMessage(axiosError(403, { message: 'x' }), i18n.t)).toMatch(/keine berechtigung/i)
    expect(webhookErrorMessage(axiosError(409, { message: 'x' }), i18n.t)).toMatch(/gerade gesendet/i)
    expect(webhookErrorMessage(axiosError(429, { message: 'x' }), i18n.t)).toMatch(/zu viele/i)
  })

  it('labels delivery errors incl. connection codes', () => {
    expect(deliveryErrorLabel(null, i18n.t)).toBeNull()
    expect(deliveryErrorLabel('timeout', i18n.t)).toBe('Zeitüberschreitung (10 s)')
    expect(deliveryErrorLabel('connection_failed: ECONNREFUSED', i18n.t)).toBe(
      'Verbindung fehlgeschlagen (ECONNREFUSED)'
    )
    expect(deliveryErrorLabel('something_new', i18n.t)).toBe('something_new')
  })

  it('uses plural forms for the failure counter', () => {
    expect(i18n.t('webhooks.status.failures', { count: 1 })).toBe('1 Fehlschlag in Folge')
    expect(i18n.t('webhooks.status.failures', { count: 7 })).toBe('7 Fehlschläge in Folge')
  })

  it('ships a verification snippet that accepts valid and rejects forged signatures', () => {
    // Evaluate the snippet as a module body with Node's crypto injected
    const body = SIGNATURE_SNIPPET.replace("import crypto from 'node:crypto'", '').replace('export function', 'function')
    const verify = new Function('crypto', 'Buffer', `${body}\nreturn verifyTranslatelySignature`)(
      { createHmac, timingSafeEqual },
      Buffer
    ) as (raw: string, header: string, secret: string) => boolean
    const secret = 'whsec_test'
    const raw = '{"id":"evt_1"}'
    const t = Math.floor(Date.now() / 1000)
    const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
    expect(verify(raw, `t=${t},v1=${v1}`, secret)).toBe(true)
    expect(verify(raw, `t=${t},v1=${'0'.repeat(64)}`, secret)).toBe(false)
    expect(verify(`${raw} `, `t=${t},v1=${v1}`, secret)).toBe(false)
    const old = t - 600
    const oldSig = createHmac('sha256', secret).update(`${old}.${raw}`).digest('hex')
    expect(verify(raw, `t=${old},v1=${oldSig}`, secret)).toBe(false)
  })
})
