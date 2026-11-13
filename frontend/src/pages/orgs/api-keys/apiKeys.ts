// Types and helpers of the organization API keys page.

export type ApiKeyType = 'CLIENT' | 'SERVER' | 'SDK' | 'MCP'

/** `GET /api-keys/organization/:orgId` – `key` is masked for roles below ADMIN. */
export interface ApiKey {
  id: string
  name: string
  type: ApiKeyType
  key: string
  isActive: boolean
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  /** The user who created the key. */
  userId?: string | null
  /** Project an MCP key is bound to. */
  projectId?: string | null
}

/** Types an ADMIN may create; SDK is a legacy type, shown but not created. */
export const CREATE_KEY_TYPES = ['CLIENT', 'SERVER', 'MCP'] as const

/** Types a MEMBER may create: only MCP keys, bound to one project. */
export const MEMBER_KEY_TYPES = ['MCP'] as const

/**
 * Client configuration for an MCP client (`mcpServers` format) that connects
 * to this instance with `key`.
 */
export function mcpClientConfig(origin: string, key: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        translately: {
          type: 'http',
          url: `${origin}/api/mcp`,
          headers: { Authorization: `Bearer ${key}` },
        },
      },
    },
    null,
    2
  )
}

/** Expiry choices in days; `''` = never. */
export const EXPIRY_OPTIONS = ['30', '90', '365', ''] as const

/** Short display form `tk_ab12…9f3e`; already masked keys stay as they are. */
export function displayKey(key: string): string {
  if (!key || key.includes('…')) return key || '…'
  if (key.length <= 11) return '…'
  return `${key.slice(0, 7)}…${key.slice(-4)}`
}

export type ExpiryState = 'never' | 'valid' | 'soon' | 'expired'

const DAY = 24 * 60 * 60 * 1000

/** Whether a key has expired or expires within 7 days. */
export function expiryState(
  expiresAt: string | null | undefined,
  now: number = Date.now()
): ExpiryState {
  if (!expiresAt) return 'never'
  const time = new Date(expiresAt).getTime()
  if (Number.isNaN(time)) return 'never'
  if (time <= now) return 'expired'
  if (time - now <= 7 * DAY) return 'soon'
  return 'valid'
}
