import api from '@/lib/axios'
import { useProjectRole } from '@/lib/permissions'

export type ProjectType = 'SINGLE' | 'MULTI'

/** `GET /projects/:id` */
export interface ProjectDetails {
  id: string
  name: string
  key: string
  description: string | null
  type: ProjectType
  allowedOrigins: string[]
  organizationId: string
  /** Standard languages of the project (stored as entered). */
  languages?: string[]
  /** Namespaces; the default `translation` cannot be removed. */
  namespaces?: string[]
}

export async function fetchProject(projectId: string): Promise<ProjectDetails> {
  const response = await api.get(`/projects/${projectId}`)
  return response.data.project
}

/** Turns a display name into a key (`My Brand` → `my-brand`). */
export function toKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Keeps only characters allowed in keys while the user types. */
export function sanitizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

/** Moved to `@/lib/errors`; re-exported for existing imports. */
export { apiMessage } from '@/lib/errors'

/**
 * Project structure (brands, settings, deletion) may be changed by
 * ADMIN+ of the project's organization. `roleLoading` is true until the role is known.
 */
export function useCanManageProject(projectId: string): {
  canManage: boolean
  roleLoading: boolean
  /** The workspace failed to load; show `RoleUnavailableNotice`. */
  roleUnavailable: boolean
  organizationId: string | undefined
} {
  const { canManage, roleLoading, roleUnavailable, organizationId } =
    useProjectRole(projectId)
  return { canManage, roleLoading, roleUnavailable, organizationId }
}
