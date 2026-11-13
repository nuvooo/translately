import { createHash } from 'node:crypto'

export interface SdkEtagScope {
  organizationId: string
  projectId: string
}

/**
 * Weak ETag of an SDK response: changes whenever the configuration version
 * of the project changes, and differs per tenant scope (organization,
 * project: no collisions across tenants) and request shape (`parts`, hashed in array order). The parts
 * are JSON-encoded as an array, so `['de', 'a']`, `['a', 'de']` and
 * `['de,a']` never collide.
 */
export function computeSdkEtag(
  version: number,
  scope: SdkEtagScope,
  parts: string[]
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify([scope.organizationId, scope.projectId, parts]))
    .digest('hex')
    .slice(0, 16)
  return `W/"${version}-${hash}"`
}

const stripWeak = (tag: string) => tag.trim().replace(/^W\//, '')

/** If-None-Match uses weak comparison (RFC 9110 13.1.2). */
export function etagMatches(
  ifNoneMatch: string | string[] | undefined,
  etag: string
): boolean {
  const header = Array.isArray(ifNoneMatch)
    ? ifNoneMatch.join(',')
    : ifNoneMatch
  if (!header) return false
  if (header.trim() === '*') return true
  const target = stripWeak(etag)
  return header.split(',').some((tag) => stripWeak(tag) === target)
}
