import type { AxiosError } from 'axios'

export interface ApiError {
  statusCode: number
  message: string | string[]
  error: string
}

export function getErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as ApiError | undefined
    if (data?.message) {
      return Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message
    }
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'An unexpected error occurred'
}

function isAxiosError(error: unknown): error is AxiosError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'isAxiosError' in error &&
    (error as AxiosError).isAxiosError === true
  )
}

/** HTTP status of a failed API call, if any. */
export function getErrorStatus(error: unknown): number | undefined {
  return isAxiosError(error) ? error.response?.status : undefined
}

/** Machine-readable `code` of a failed API call (e.g. RESET_REQUIRES_SERVER_ADMIN). */
export function getErrorCode(error: unknown): string | undefined {
  if (!isAxiosError(error)) return undefined
  const code = (error.response?.data as { code?: unknown } | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

/**
 * Message of a failed API call (`message` of Nest errors, `error` of older
 * handlers), or `fallback` when the server sent none.
 */
export function apiMessage(error: unknown, fallback: string): string {
  const data = (
    error as { response?: { data?: { message?: unknown; error?: unknown } } }
  )?.response?.data
  const message = data?.message
  if (Array.isArray(message) && message.length > 0) return message.join(', ')
  if (typeof message === 'string' && message) return message
  if (typeof data?.error === 'string' && data.error) return data.error
  return fallback
}
