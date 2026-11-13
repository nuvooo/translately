export const MAX_KEY_LENGTH = 256
export const MAX_VALUE_LENGTH = 10_000
export const MAX_DESCRIPTION_LENGTH = 500
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
export const MAX_IMPORT_KEYS = 20_000
export const MAX_LANGUAGES = 100
export const MAX_NAMESPACES = 50
export const MAX_PAGE_SIZE = 200
export const DEFAULT_PAGE_SIZE = 50
export const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
export const NAMESPACE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const DEFAULT_NAMESPACE = 'translation'
export const DEFAULT_SCOPE = 'default'

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

export function isValidKey(key: string): boolean {
  if (typeof key !== 'string') return false
  if (key.length < 1 || key.length > MAX_KEY_LENGTH) return false
  if (hasControlCharacter(key)) return false
  if (key.startsWith('.') || key.endsWith('.') || key.includes('..'))
    return false
  return !key.split('.').some((segment) => FORBIDDEN_SEGMENTS.has(segment))
}
