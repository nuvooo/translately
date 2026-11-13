import { Loader2, Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SettingsSection } from '@/components/page/SettingsSection'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { handleForbidden, notifyWriteError } from '@/lib/permissions'
import { addNamespace, removeNamespace } from '../translations/api'
import { apiMessage, type ProjectDetails } from './project'

/** Namespace rule of the server. */
export const NAMESPACE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const MAX_NAMESPACES = 50
/** The default namespace; the server refuses to remove it. */
export const DEFAULT_NAMESPACE = 'translation'

/** Locale key of the problem with `name`, or null when it may be added. */
export function namespaceError(name: string, existing: string[]) {
  if (!NAMESPACE_PATTERN.test(name))
    return 'project-settings.namespaces.error-invalid'
  if (existing.includes(name))
    return 'project-settings.namespaces.error-duplicate'
  return null
}

interface NamespacesSectionProps {
  project: ProjectDetails
  canManage: boolean
  onSaved: (project: ProjectDetails) => void
}

/**
 * Namespaces of the project. Adding is immediate; removing deletes all keys
 * of the namespace with their texts and therefore asks first.
 */
export function NamespacesSection({
  project,
  canManage,
  onSaved,
}: NamespacesSectionProps) {
  const { t } = useTranslation()
  const namespaces = project.namespaces ?? []
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  // Outlives the open state so the dialog keeps its text while closing.
  const [removing, setRemoving] = useState<string | null>(null)
  const inputId = useId()
  const errorId = useId()

  const name = draft.trim()
  const full = namespaces.length >= MAX_NAMESPACES
  const error = name === '' ? null : namespaceError(name, namespaces)

  const add = async () => {
    if (adding || full || name === '' || error) return
    setAdding(true)
    try {
      const result = await addNamespace(project.id, name)
      onSaved({ ...project, namespaces: result.namespaces })
      setDraft('')
      toast.success(t('project-settings.namespaces.added', { namespace: name }))
    } catch (err) {
      notifyWriteError(
        err,
        t,
        apiMessage(err, t('project-settings.namespaces.add-failed'))
      )
    } finally {
      setAdding(false)
    }
  }

  const confirmRemove = async () => {
    if (!removing) return
    try {
      const result = await removeNamespace(project.id, removing)
      onSaved({ ...project, namespaces: result.namespaces })
      toast.success(
        t('project-settings.namespaces.removed', {
          namespace: removing,
          count: result.removedKeys,
        })
      )
    } catch (err) {
      // A 403 closes the dialog (the role is reloaded); other errors stay in it.
      if (handleForbidden(err, t)) return
      throw new Error(
        apiMessage(err, t('project-settings.namespaces.remove-failed'))
      )
    }
  }

  return (
    <SettingsSection
      title={t('project-settings.namespaces.title')}
      description={t('project-settings.namespaces.description')}
    >
      <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
        {canManage && (
          <div className="space-y-2">
            <Label htmlFor={inputId}>
              {t('project-settings.namespaces.add-label')}
            </Label>
            <div className="flex gap-2">
              <Input
                id={inputId}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void add()
                  }
                }}
                placeholder={t('project-settings.namespaces.placeholder')}
                autoComplete="off"
                spellCheck={false}
                disabled={full || adding}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? errorId : undefined}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void add()}
                disabled={full || adding || name === '' || error !== null}
                aria-label={t('project-settings.namespaces.add-aria')}
              >
                {adding ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="mr-1 h-4 w-4" aria-hidden />
                )}
                {t('project-settings.namespaces.add')}
              </Button>
            </div>
            {error && (
              <p id={errorId} className="text-xs text-destructive">
                {t(error, { namespace: name })}
              </p>
            )}
            {full && (
              <p className="text-xs text-muted-foreground">
                {t('project-settings.namespaces.max', { max: MAX_NAMESPACES })}
              </p>
            )}
          </div>
        )}

        <ul
          aria-label={t('project-settings.namespaces.list')}
          className="divide-y rounded-md border"
        >
          {namespaces.map((namespace) => (
            <li
              key={namespace}
              data-namespace={namespace}
              className="flex min-h-10 items-center justify-between gap-2 px-3 py-1.5"
            >
              <code className="min-w-0 truncate font-mono text-xs">
                {namespace}
              </code>
              {canManage && namespace !== DEFAULT_NAMESPACE && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={t('project-settings.namespaces.remove', {
                    namespace,
                  })}
                  onClick={() => {
                    setRemoving(namespace)
                    setRemoveOpen(true)
                  }}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {canManage && (
        <ConfirmDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          title={t('project-settings.namespaces.confirm-title', {
            namespace: removing ?? '',
          })}
          description={t('project-settings.namespaces.confirm-text')}
          confirmLabel={t('project-settings.namespaces.confirm')}
          onConfirm={confirmRemove}
        />
      )}
    </SettingsSection>
  )
}
